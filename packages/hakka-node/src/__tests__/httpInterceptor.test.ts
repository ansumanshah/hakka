import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'
import net from 'node:net'

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

  test('captures real multi-value Set-Cookie as an array on responseHeaderValues, folded value still on responseHeaders', async () => {
    const server = http.createServer((_req, res) => {
      // Node hands `set-cookie` back to the client as a real string[] when the
      // server sets more than one — this is what RFC 6265 §3 requires and
      // what a naive comma-join would corrupt.
      res.setHeader('Set-Cookie', ['session=abc; Path=/', 'consent=yes; Path=/'])
      res.setHeader('content-type', 'application/json')
      res.writeHead(200)
      res.end('{"ok":true}')
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1_000_000, [])

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/login', method: 'GET' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/login'))
    expect(rec?.responseHeaders?.['set-cookie']).toBe('session=abc; Path=/, consent=yes; Path=/')
    expect(rec?.responseHeaderValues?.['set-cookie']).toEqual(['session=abc; Path=/', 'consent=yes; Path=/'])
  })

  test('a single-value header never appears in responseHeaderValues', async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.writeHead(200)
      res.end('{"ok":true}')
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1_000_000, [])

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/single', method: 'GET' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/single'))
    expect(rec?.responseHeaders?.['content-type']).toBe('application/json')
    expect(rec?.responseHeaderValues).toBeUndefined()
  })

  test('redacts every value of a sensitive multi-value response header, in both responseHeaders and responseHeaderValues', async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader('Set-Cookie', ['session=abc; Path=/', 'consent=yes; Path=/'])
      res.writeHead(200)
      res.end('ok')
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1_000_000, ['set-cookie'])

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/redact', method: 'GET' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/redact'))
    expect(rec?.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
    expect(rec?.responseHeaderValues?.['set-cookie']).toEqual(['[REDACTED]', '[REDACTED]'])
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

  test("a socket 'timeout' that isn't fatal does not clobber the real response that arrives later", async () => {
    // Node's 'timeout' event is advisory — it only means the socket has been
    // idle, not that the request failed. This upstream is slow but alive: it
    // responds well after the request's socket timeout fires, and the caller
    // deliberately does NOT abort on 'timeout' (the documented, valid way to
    // treat it as informational). The real 200 must win, not a fabricated
    // timeout record.
    const server = http.createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{"ok":true}')
      }, 150)
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/slow-but-alive', timeout: 40 }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.on('timeout', () => {}) // observed, deliberately not fatal — no destroy()
      req.end()
    })
    await settle()
    server.close()

    const recs = records.filter((r) => r.url.includes('/slow-but-alive'))
    expect(recs.length).toBe(1)
    expect(recs[0]?.status).toBe(200)
    expect(recs[0]?.error).toBeUndefined()
  })

  test("a socket 'timeout' followed by req.destroy() with no response ever arriving records the REAL abort reason, not a fabricated 'timeout'", async () => {
    // The other half of the contract: when the caller DOES treat 'timeout' as
    // fatal (the documented pattern — destroy the request themselves) and no
    // response ever comes, the request must not vanish from the inspector
    // just because the fix stopped treating 'timeout' itself as terminal.
    // Destroying an in-flight request makes Node/undici raise a real 'error'
    // (a "socket hang up" — verified empirically in this runtime) before
    // 'close' fires, so that's the record that must win — not a fabricated
    // `error: 'timeout'` a pre-fix interceptor would have already locked in
    // before this 'error' ever had a chance to fire.
    const server = http.createServer(() => {
      // Deliberately never respond.
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/hangs', timeout: 40 })
      req.on('timeout', () => req.destroy())
      req.on('error', () => {})
      req.on('close', () => resolve())
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/hangs'))
    expect(rec).toBeTruthy()
    expect(rec?.status).toBeNull()
    expect(rec?.error).toBeTruthy()
    expect(rec?.error).not.toBe('timeout')
  })

  test("a socket 'timeout' with no destroy, whose peer never responds or closes, surfaces via the fallback grace window instead of vanishing forever", async () => {
    // The gap the 'close'-only fix (above) leaves open on its own: if the
    // caller treats 'timeout' as informational (no destroy — same valid
    // pattern as the "not fatal" test above) AND the peer neither responds
    // nor tears down the TCP connection, the request's own 'close' never
    // fires either, so nothing would ever emit a record without this
    // fallback. `timeoutFallbackGraceMs` is shrunk here so the test doesn't
    // have to wait out the real 30s production default.
    const server = http.createServer(() => {
      // Deliberately never respond, never end() — a peer gone silent.
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    const graceMs = 30
    enableHttpInterceptor((r) => records.push(r), 1000, [], undefined, { timeoutFallbackGraceMs: graceMs })

    const req = http.request({ host: '127.0.0.1', port, path: '/hangs-forever', timeout: 20 })
    req.on('timeout', () => {}) // observed, deliberately not fatal — no destroy()
    req.on('error', () => {})
    req.end()

    // Long enough for both the socket timeout (20ms) and the fallback grace
    // window (30ms) to have elapsed.
    await new Promise((r) => setTimeout(r, graceMs + 100))

    const rec = records.find((r) => r.url.includes('/hangs-forever'))
    expect(rec).toBeTruthy()
    expect(rec?.status).toBeNull()
    expect(rec?.error).toBe('timeout')

    req.destroy()
    server.close()
  })

  test('captures a multibyte UTF-8 body split across write() calls without corrupting it', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => res.end('ok'))
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    // '€' (U+20AC) is 3 UTF-8 bytes (E2 82 AC). Splitting the buffer inside
    // that sequence, across two write() calls, is exactly what a naive
    // per-chunk `.toString('utf8')` corrupts into replacement characters.
    const text = 'price: €100'
    const full = Buffer.from(text, 'utf8')
    const euroStart = full.indexOf(Buffer.from('€', 'utf8'))
    const splitAt = euroStart + 1 // lands inside the 3-byte sequence

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/split-utf8', method: 'POST' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.write(full.subarray(0, splitAt))
      req.write(full.subarray(splitAt))
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/split-utf8'))
    expect(rec?.requestBody).toBe(text)
    // Byte-accounted, not char-accounted — matters once the body has any
    // multibyte content at all, where char length and byte length diverge.
    expect(rec?.requestBodySize).toBe(Buffer.byteLength(text, 'utf8'))
  })

  test('injectHeaders appends onto array-form options.headers without corrupting it into numeric-keyed junk', async () => {
    // A real HTTP server can't be used as the SUT here: Node's own
    // `http.request` doesn't add a default `Host` header when `headers` is
    // array-form (independent of this interceptor), so any compliant server
    // 400s the request regardless of whether the array survives intact. A
    // raw socket, asserting on the literal bytes sent, isolates the one
    // thing this test cares about.
    let rawRequest = ''
    const server = net.createServer((socket) => {
      let buf = ''
      socket.on('data', (d) => {
        buf += d.toString('utf8')
        if (buf.includes('\r\n\r\n') && !rawRequest) {
          rawRequest = buf
          socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok')
        }
      })
    })
    const port = await new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
    )

    setTraceProvider(() => 'T-ARR')
    enableHttpInterceptor(() => {}, 1000, [])

    await new Promise<void>((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/arr',
        method: 'GET',
        headers: ['X-Foo', 'bar'],
      })
      req.on('response', (resp) => {
        resp.on('data', () => {})
        resp.on('end', resolve)
      })
      req.on('error', () => resolve())
      req.end()
    })
    await settle()
    server.close()

    expect(rawRequest).toContain('X-Foo: bar')
    expect(rawRequest).toContain('x-hakka-trace: T-ARR')
    // The bug this guards: spreading an array into a Record turns it into
    // {0: name, 1: value, ...}, which serializes as numeric header names.
    expect(rawRequest).not.toMatch(/\r\n0:/)
    expect(rawRequest).not.toMatch(/\r\n1:/)
  })

  test('parseArgs reads array-form options.headers into rec.requestHeaders correctly, not numeric-keyed junk', async () => {
    // Companion to the wire-level test above: that one only proves the bytes
    // sent over the socket survive array-form headers intact. `parseArgs`
    // (a SEPARATE code path feeding the captured record shown in Hakka's own
    // inspector, not the request Node actually sends) had the identical bug —
    // `Object.entries(['X-Foo', 'bar'])` yields {0: 'X-Foo', 1: 'bar'} — so a
    // request with array-form headers could send correctly on the wire while
    // still showing garbage in `rec.requestHeaders`.
    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)

    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    await new Promise<void>((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/arr-record',
        method: 'GET',
        headers: ['X-Foo', 'bar', 'X-Baz', 'qux'],
      })
      req.on('response', (resp) => {
        resp.on('data', () => {})
        resp.on('end', resolve)
      })
      req.on('error', () => resolve())
      req.end()
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/arr-record'))
    expect(rec?.requestHeaders?.['X-Foo']).toBe('bar')
    expect(rec?.requestHeaders?.['X-Baz']).toBe('qux')
    // The bug this guards: numeric-keyed junk instead of the real header names.
    expect(rec?.requestHeaders?.['0']).toBeUndefined()
    expect(rec?.requestHeaders?.['1']).toBeUndefined()
  })

  test('a URL that merely CONTAINS a bridge host string (e.g. in a query value) is still captured', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [])

    await new Promise<void>((resolve, reject) => {
      // Real host is 127.0.0.1:<port> — not a bridge host — but the URL
      // string contains a default bridge host ('localhost:8989') as a query
      // value. Substring matching would wrongly skip this request.
      const req = http.request(`http://127.0.0.1:${port}/?cb=localhost:8989`, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
    await settle()
    server.close()

    expect(records.some((r) => r.url.includes('cb=localhost:8989'))).toBe(true)
  })

  test('shouldCapture receives the in-flight URL', async () => {
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    const records: NetworkRequest[] = []
    const seenUrls: string[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, [], undefined, {
      shouldCapture: (url) => {
        seenUrls.push(url)
        return true
      },
    })

    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/gate-url' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.end()
    })
    await settle()
    server.close()

    expect(seenUrls.some((u) => u.includes('/gate-url'))).toBe(true)
    expect(records.some((r) => r.url.includes('/gate-url'))).toBe(true)
  })

  test('headers set via req.setHeader() after construction are captured and redacted like construction-time headers', async () => {
    let sawAuth: string | undefined
    const server = http.createServer((req, res) => {
      sawAuth = req.headers['authorization'] as string | undefined
      res.end('ok')
    })
    const port = await listen(server)
    const records: NetworkRequest[] = []
    enableHttpInterceptor((r) => records.push(r), 1000, ['authorization'])

    await new Promise<void>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/late-header', method: 'GET' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.on('error', reject)
      // Set AFTER construction — the case the initial options.headers
      // snapshot can't see.
      req.setHeader('X-Late', 'hello')
      req.setHeader('authorization', 'super-secret')
      req.end()
    })
    await settle()
    server.close()

    expect(sawAuth).toBe('super-secret') // the real request still carries it
    const rec = records.find((r) => r.url.includes('/late-header'))
    expect(rec?.requestHeaders?.['X-Late']).toBe('hello')
    expect(rec?.requestHeaders?.['authorization']).toBe('[REDACTED]')
  })
})
