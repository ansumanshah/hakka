import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import type { NetworkRequest } from 'hakka-core'
import { setTraceProvider } from 'hakka-core'

import { disableHttpInterceptor, enableHttpInterceptor } from '../httpInterceptor'
import { parseTraceparent } from '../trace'

afterEach(() => {
  disableHttpInterceptor()
  setTraceProvider(null)
})

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

const settle = () => new Promise((r) => setTimeout(r, 15))

describe('http interceptor', () => {
  test('captures a GET: url, method, status, source, timing', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1_000_000, ['authorization'])

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/users', method: 'GET' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/users'))
    expect(rec).toBeTruthy()
    expect(rec?.method).toBe('GET')
    expect(rec?.status).toBe(200)
    expect(rec?.source).toBe('http')
    expect(rec?.contentType).toContain('application/json')
    expect(rec?.duration).toBeGreaterThanOrEqual(0)
  })

  test('captures POST body and redacts sensitive headers', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => {
        res.writeHead(201)
        res.end('ok')
      })
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1_000_000, ['authorization'])

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/login',
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'super-secret' },
        },
        (resp) => {
          resp.on('data', () => {})
          resp.on('end', () => resolve())
        },
      )
      req.on('error', reject)
      req.write('{"u":"ada"}')
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/login'))
    expect(rec?.method).toBe('POST')
    expect(rec?.requestBody).toBe('{"u":"ada"}')
    expect(rec?.requestHeaders?.authorization).toBe('[REDACTED]')
    expect(rec?.requestHeaders?.['content-type']).toBe('application/json')
    expect(rec?.status).toBe(201)
  })

  test('http.get is intercepted too', async () => {
    const server = http.createServer((_req, res) => res.end('hi'))
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    await new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${port}/g`, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
    })
    await settle()
    server.close()
    expect(records.some((r) => r.url.includes('/g'))).toBe(true)
  })

  test('emits an error record when the connection fails', async () => {
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])
    await new Promise<void>((resolve) => {
      // 127.0.0.1:1 — nothing listens; connection refused.
      const req = http.request({ host: '127.0.0.1', port: 1, path: '/x', method: 'GET' })
      req.on('error', () => resolve())
      req.end()
    })
    await settle()
    const rec = records.find((r) => r.url.includes('/x'))
    expect(rec?.error).toBeTruthy()
    expect(rec?.status).toBeNull()
  })

  test('does not capture the bridge socket host', async () => {
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])
    await new Promise<void>((resolve) => {
      const req = http.request({ host: 'localhost', port: 8989, path: '/' })
      // Resolve on EITHER outcome: normally nothing listens on 8989 and 'error'
      // fires, but a dev machine running an embedded bridge hub answers — the
      // assertion (bridge-host requests are never captured) holds either way.
      req.on('error', () => resolve())
      req.on('response', (res) => {
        res.resume()
        res.on('end', () => resolve())
        res.on('close', () => resolve())
      })
      req.end()
    })
    await settle()
    expect(records.length).toBe(0)
  })

  test('honors a custom bridgeHosts list instead of the default', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    const records: NetworkRequest[] = []
    // Treat 127.0.0.1:<port> as a bridge host — it must be skipped.
    enableHttpInterceptor((r) => records.push(r), 1000, [], [`127.0.0.1:${port}`])
    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/skip-me' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.end()
    })
    await settle()
    server.close()
    expect(records.length).toBe(0)
  })

  test('propagates x-hakka-trace and a matching W3C traceparent onto the outgoing request', async () => {
    let sawTraceHeader: string | undefined
    let sawTraceparent: string | undefined
    const server = http.createServer((req, res) => {
      sawTraceHeader = req.headers['x-hakka-trace'] as string | undefined
      sawTraceparent = req.headers['traceparent'] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    setTraceProvider(() => 'T-UPSTREAM')
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/hop' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.end()
    })
    await settle()
    server.close()

    expect(sawTraceHeader).toBe('T-UPSTREAM')
    expect(sawTraceparent).toBeTruthy()
    expect(parseTraceparent(sawTraceparent)).toBeTruthy() // well-formed traceparent

    const rec = records.find((r) => r.url.includes('/hop'))
    expect(rec?.correlationId).toBe('T-UPSTREAM')
    // The captured record's own headers reflect what was actually sent.
    expect(rec?.requestHeaders?.['x-hakka-trace']).toBe('T-UPSTREAM')
    expect(rec?.requestHeaders?.traceparent).toBeTruthy()
  })

  test('does not clobber a traceparent the caller already set explicitly', async () => {
    let sawTraceparent: string | undefined
    const server = http.createServer((req, res) => {
      sawTraceparent = req.headers['traceparent'] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    setTraceProvider(() => 'T-UPSTREAM')
    enableHttpInterceptor(() => {}, 1000, [])

    const explicit = '00-11111111111111111111111111111111-2222222222222222-01'
    await new Promise<void>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port, path: '/explicit', headers: { traceparent: explicit } },
        (resp) => {
          resp.on('data', () => {})
          resp.on('end', () => resolve())
        },
      )
      req.end()
    })
    await settle()
    server.close()

    expect(sawTraceparent).toBe(explicit)
  })

  test('phase timing on a fresh connection: ttfbMs, downloadMs, timing.total', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('hello')
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/timing', method: 'GET' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/timing'))
    expect(rec).toBeTruthy()
    // ttfb/download are always measurable — the response actually arrived and completed.
    expect(rec?.ttfbMs).toBeGreaterThanOrEqual(0)
    expect(rec?.downloadMs).toBeGreaterThanOrEqual(0)
    // timing mirrors the fetch interceptor's shape, with `total` == the top-level duration.
    expect(rec?.timing?.total).toBe(rec?.duration)
    expect(rec?.timing?.ttfbMs).toBe(rec?.ttfbMs)
    expect(rec?.timing?.downloadMs).toBe(rec?.downloadMs)
    // connect (and dns, on hosts that resolve) are best-effort — assert non-negative
    // only when the socket lifecycle actually produced a value.
    if (rec?.connectMs != null) expect(rec.connectMs).toBeGreaterThanOrEqual(0)
    if (rec?.dnsMs != null) expect(rec.dnsMs).toBeGreaterThanOrEqual(0)
  })

  test('keep-alive reuse: second request has dns/connect/tls undefined but still has ttfbMs', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    const agent = new http.Agent({ keepAlive: true })
    const get = (path: string) =>
      new Promise<void>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', agent }, (resp) => {
          resp.on('data', () => {})
          resp.on('end', () => resolve())
        })
        req.on('error', reject)
        req.end()
      })

    await get('/keepalive-1')
    await settle() // let the socket settle back into the agent's free pool
    await get('/keepalive-2')
    await settle()

    agent.destroy()
    server.close()

    const second = records.find((r) => r.url.includes('/keepalive-2'))
    expect(second).toBeTruthy()
    // The socket was reused — dns/connect/tls didn't happen for THIS request.
    expect(second?.dnsMs).toBeUndefined()
    expect(second?.connectMs).toBeUndefined()
    expect(second?.tlsMs).toBeUndefined()
    // ttfb/download are per-request regardless of socket reuse.
    expect(second?.ttfbMs).toBeGreaterThanOrEqual(0)
    expect(second?.downloadMs).toBeGreaterThanOrEqual(0)
  })

  test('shouldCapture: false skips capture AND skips trace-header injection (evaluated before trace/header work)', async () => {
    let sawTraceHeader: string | undefined
    let sawTraceparent: string | undefined
    const server = http.createServer((req, res) => {
      sawTraceHeader = req.headers['x-hakka-trace'] as string | undefined
      sawTraceparent = req.headers['traceparent'] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    // A trace IS active — if the gate ran after trace/header work (or not at
    // all), this request would carry both headers, same as the 'propagates
    // x-hakka-trace…' test above.
    setTraceProvider(() => 'T-GATED-OUT')
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [], undefined, { shouldCapture: () => false })

    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/gated' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.end()
    })
    await settle()
    server.close()

    expect(records.length).toBe(0)
    expect(sawTraceHeader).toBeUndefined()
    expect(sawTraceparent).toBeUndefined()
  })

  test('shouldCapture: true (or absent) still captures normally', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [], undefined, { shouldCapture: () => true })

    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/gated-in' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.end()
    })
    await settle()
    server.close()
    expect(records.some((r) => r.url.includes('/gated-in'))).toBe(true)
  })

  test('a throwing shouldCapture gate fails toward "not captured", never breaking the request', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [], undefined, {
      shouldCapture: () => {
        throw new Error('gate blew up')
      },
    })

    let body = ''
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/gate-throws' }, (resp) => {
        resp.on('data', (c) => (body += c))
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
    await settle()
    server.close()

    expect(body).toBe('ok') // the real request still went through untouched
    expect(records.length).toBe(0)
  })

  test('http.get (url + callback, no options object) still gets trace headers injected', async () => {
    let sawTraceHeader: string | undefined
    const server = http.createServer((req, res) => {
      sawTraceHeader = req.headers['x-hakka-trace'] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)

    setTraceProvider(() => 'T-GET')
    enableHttpInterceptor(() => {}, 1000, [])

    await new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${port}/g2`, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
    })
    await settle()
    server.close()
    expect(sawTraceHeader).toBe('T-GET')
  })
})
