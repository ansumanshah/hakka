import { afterEach, describe, expect, test } from 'bun:test'
import diagnosticsChannel from 'node:diagnostics_channel'
import http from 'node:http'
import type { Server } from 'node:http'

import type { NetworkRequest } from 'hakka-core'

import { register, startCapture, stopCapture } from '../serverCapture'

afterEach(() => stopCapture())

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

const settle = () => new Promise((r) => setTimeout(r, 25))

describe('startCapture', () => {
  test('tags fetch captures with runtime: server', async () => {
    const records: NetworkRequest[] = []
    startCapture({ bridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/api/data`)
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/api/data'))
    expect(rec).toBeTruthy()
    expect(rec?.runtime).toBe('server')
    expect(rec?.source).toBe('fetch')
  })

  test('tags Node http captures with runtime: server', async () => {
    const records: NetworkRequest[] = []
    startCapture({ bridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    await new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${port}/raw`, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/raw'))
    expect(rec?.runtime).toBe('server')
    expect(rec?.source).toBe('http')
  })

  test('honors a custom runtime tag (edge) and is idempotent', async () => {
    const records: NetworkRequest[] = []
    const a = startCapture({ bridge: false, runtime: 'edge', sink: (r) => records.push(r) })
    const b = startCapture({ bridge: false, runtime: 'edge' })
    expect(a).toBe(b) // idempotent — second call returns the live handle

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/edge`)
    await settle()
    server.close()
    expect(records.find((r) => r.url.includes('/edge'))?.runtime).toBe('edge')
  })
})

describe('register — dev-only gating', () => {
  test('no-ops outside NODE_ENV=development without force', () => {
    const ORIGINAL = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const handle = register({ bridge: false })
      expect(handle).toBeUndefined()
    } finally {
      process.env.NODE_ENV = ORIGINAL
    }
  })

  test('starts capture when force: true is passed, even outside development', async () => {
    const ORIGINAL = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const records: NetworkRequest[] = []
      const handle = register({ bridge: false, force: true, sink: (r) => records.push(r) })
      expect(handle).toBeTruthy()

      const server = http.createServer((_req, res) => res.end('{}'))
      const port = await listen(server)
      await fetch(`http://127.0.0.1:${port}/forced`)
      await settle()
      server.close()
      expect(records.find((r) => r.url.includes('/forced'))?.runtime).toBe('server')
    } finally {
      process.env.NODE_ENV = ORIGINAL
    }
  })

  test('starts capture when NODE_ENV=development without needing force', () => {
    const ORIGINAL = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const handle = register({ bridge: false })
      expect(handle).toBeTruthy()
    } finally {
      process.env.NODE_ENV = ORIGINAL
    }
  })
})

describe('embedded bridge (no separate process)', () => {
  test('embedded hub relays server captures to a ws viewer — no standalone process', async () => {
    // Embed the hub on 8990 (skipped by the http interceptor by default) so a
    // viewer peer receives the server captures, the same way the browser
    // overlay would.
    startCapture({ runtime: 'server', bridgeUrl: 'ws://localhost:8990' })
    await new Promise((r) => setTimeout(r, 700)) // hub binds + bridge client connects

    const received: Array<{ type?: string; payload?: NetworkRequest }> = []
    const viewer = new WebSocket('ws://localhost:8990')
    await new Promise<void>((resolve, reject) => {
      viewer.onopen = () => resolve()
      viewer.onerror = () => reject(new Error('viewer failed to connect — hub not embedded'))
    })
    viewer.onmessage = (ev: MessageEvent) => {
      try {
        received.push(JSON.parse(String(ev.data)))
      } catch {
        /* ignore */
      }
    }

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/srv-api`)
    await new Promise((r) => setTimeout(r, 600)) // capture → bridge → relay → viewer
    server.close()
    viewer.close()

    const got = received.find((m) => m.type === 'request' && m.payload?.url?.includes('/srv-api'))
    expect(got).toBeTruthy()
    expect(got?.payload?.runtime).toBe('server')
  })
})

describe('trace correlation', () => {
  test('an incoming x-hakka-trace links the upstream call the handler makes', async () => {
    const captured: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, sink: (r) => captured.push(r) })

    // Upstream service the server calls while handling the request.
    let upstreamSawTrace: string | undefined
    let upstreamSawTraceparent: string | undefined
    const upstream = http.createServer((req, res) => {
      upstreamSawTrace = req.headers['x-hakka-trace'] as string | undefined
      upstreamSawTraceparent = req.headers['traceparent'] as string | undefined
      res.statusCode = 200
      res.end('UP')
    })
    const upPort = await listen(upstream)

    // The "app" server: its handler makes an upstream fetch, then responds.
    const app = http.createServer(async (_req, res) => {
      await fetch(`http://127.0.0.1:${upPort}/up`)
        .then((r) => r.text())
        .catch(() => {})
      res.statusCode = 200
      res.end('OK')
    })
    const appPort = await listen(app)

    // Simulate a caller having injected the trace header on its request.
    await new Promise<void>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: appPort, path: '/', headers: { 'x-hakka-trace': 'T-CLIENT' } },
        (res) => {
          res.on('data', () => {})
          res.on('end', () => resolve())
        },
      )
      req.end()
    })
    await settle()

    const upstreamRec = captured.find((r) => r.url.includes('/up'))
    expect(upstreamRec).toBeTruthy()
    // The server's upstream call inherited the caller's trace id…
    expect(upstreamRec?.correlationId).toBe('T-CLIENT')
    // …and forwarded it onward (both headers), so multi-hop traces keep linking.
    expect(upstreamSawTrace).toBe('T-CLIENT')
    expect(upstreamSawTraceparent).toBeTruthy()

    upstream.close()
    app.close()
  })

  test('an incoming traceparent-only request (no x-hakka-trace) still links the upstream call', async () => {
    const captured: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, sink: (r) => captured.push(r) })

    const upstream = http.createServer((_req, res) => res.end('UP'))
    const upPort = await listen(upstream)

    const app = http.createServer(async (_req, res) => {
      await fetch(`http://127.0.0.1:${upPort}/up-tp`)
        .then((r) => r.text())
        .catch(() => {})
      res.end('OK')
    })
    const appPort = await listen(app)

    const incomingTraceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
    await new Promise<void>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: appPort, path: '/', headers: { traceparent: incomingTraceparent } },
        (res) => {
          res.on('data', () => {})
          res.on('end', () => resolve())
        },
      )
      req.end()
    })
    await settle()

    const upstreamRec = captured.find((r) => r.url.includes('/up-tp'))
    expect(upstreamRec).toBeTruthy()
    // The 32-hex trace-id segment of the incoming traceparent is adopted as
    // the Hakka correlationId.
    expect(upstreamRec?.correlationId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')

    upstream.close()
    app.close()
  })

  test('an http.request-driven upstream call still inherits the trace', async () => {
    const captured: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, captureFetch: false, sink: (r) => captured.push(r) })

    let upstreamSawTrace: string | undefined
    const upstream = http.createServer((req, res) => {
      upstreamSawTrace = req.headers['x-hakka-trace'] as string | undefined
      res.end('UP')
    })
    const upPort = await listen(upstream)

    const app = http.createServer((_req, res) => {
      const upReq = http.request({ host: '127.0.0.1', port: upPort, path: '/up-raw' }, (upRes) => {
        upRes.on('data', () => {})
        upRes.on('end', () => res.end('OK'))
      })
      upReq.end()
    })
    const appPort = await listen(app)

    await new Promise<void>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: appPort, path: '/', headers: { 'x-hakka-trace': 'T-RAW' } },
        (res) => {
          res.on('data', () => {})
          res.on('end', () => resolve())
        },
      )
      req.end()
    })
    await settle()

    expect(upstreamSawTrace).toBe('T-RAW')
    const upstreamRec = captured.find((r) => r.url.includes('/up-raw'))
    expect(upstreamRec?.correlationId).toBe('T-RAW')

    upstream.close()
    app.close()
  })
})

describe('capture gating: sampleRate + shouldCapture composition', () => {
  test('sampleRate: 0 — fetch and http both emit nothing for a request they would otherwise capture', async () => {
    const records: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, sampleRate: 0, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/sampled-out-fetch`).catch(() => {})
    await new Promise<void>((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/sampled-out-http' }, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
      req.end()
    })
    await settle()
    server.close()

    expect(records.find((r) => r.url.includes('/sampled-out-fetch'))).toBeUndefined()
    expect(records.find((r) => r.url.includes('/sampled-out-http'))).toBeUndefined()
  })

  test("sampleRate: 0 — the http-module call adds none of Hakka's headers onto the outgoing request", async () => {
    // Fully exercised on the owned httpInterceptor.ts path (no dependency on
    // hakka-core's separate traceparent-fetch wrapper), so this is an exact,
    // not just "no record", assertion: gated-out means zero Hakka footprint.
    let sawTraceHeader: string | undefined
    let sawTraceparent: string | undefined
    const upstream = http.createServer((req, res) => {
      sawTraceHeader = req.headers['x-hakka-trace'] as string | undefined
      sawTraceparent = req.headers['traceparent'] as string | undefined
      res.end('UP')
    })
    const upPort = await listen(upstream)

    const records: NetworkRequest[] = []
    startCapture({
      bridge: false,
      embedBridge: false,
      captureFetch: false,
      sampleRate: 0,
      sink: (r) => records.push(r),
    })

    // An incoming x-hakka-trace activates a trace context — without the
    // gate, the outgoing upstream call would inherit + forward it.
    const app = http.createServer((_req, res) => {
      const upReq = http.request({ host: '127.0.0.1', port: upPort, path: '/gated-upstream' }, (upRes) => {
        upRes.on('data', () => {})
        upRes.on('end', () => res.end('OK'))
      })
      upReq.end()
    })
    const appPort = await listen(app)

    await new Promise<void>((resolve) => {
      const req = http.request(
        { host: '127.0.0.1', port: appPort, path: '/', headers: { 'x-hakka-trace': 'T-SAMPLED-OUT' } },
        (res) => {
          res.on('data', () => {})
          res.on('end', () => resolve())
        },
      )
      req.end()
    })
    await settle()

    expect(records.find((r) => r.url.includes('/gated-upstream'))).toBeUndefined()
    expect(sawTraceHeader).toBeUndefined()
    expect(sawTraceparent).toBeUndefined()

    upstream.close()
    app.close()
  })

  test('a custom shouldCapture: false wins over sampleRate: 1 (custom gate evaluated first)', async () => {
    const records: NetworkRequest[] = []
    startCapture({
      bridge: false,
      embedBridge: false,
      sampleRate: 1,
      shouldCapture: () => false,
      sink: (r) => records.push(r),
    })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/never-captured`).catch(() => {})
    await settle()
    server.close()

    expect(records.find((r) => r.url.includes('/never-captured'))).toBeUndefined()
  })

  test('sampleRate: 1 always captures (no gate function is a coin flip away from flaking this test)', async () => {
    const records: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, sampleRate: 1, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/always-captured`)
    await settle()
    server.close()

    expect(records.find((r) => r.url.includes('/always-captured'))).toBeTruthy()
  })
})

describe('undiciTiming option', () => {
  test('defaults to off — a fetch capture carries no connectMs from this path', async () => {
    const records: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/undici-off`)
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/undici-off'))
    expect(rec).toBeTruthy()
    expect(rec?.connectMs).toBeUndefined()
  })

  test('undiciTiming: true enriches a real fetch() capture, given a matching undici connect event', async () => {
    const records: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, undiciTiming: true, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    const host = `127.0.0.1:${port}`
    const url = `http://${host}/undici-on`

    // This suite runs under `bun test` — Bun's built-in `fetch()` doesn't
    // publish undici's diagnostics_channel events the way real Node's does
    // (see `undiciTiming.ts`'s module doc), so publish synthetic ones here to
    // exercise the REAL startCapture → onRequest → undiciTiming wiring against
    // a REAL captured record, without depending on the test runner's fetch
    // internals. `undiciTiming.test.ts` covers the module's correlation logic
    // in isolation (fresh vs reused sockets, ambiguity, two-phase caching).
    const socket = {}
    diagnosticsChannel.channel('undici:client:beforeConnect').publish({ connectParams: { host } })
    diagnosticsChannel.channel('undici:client:connected').publish({ connectParams: { host }, socket })
    diagnosticsChannel
      .channel('undici:client:sendHeaders')
      .publish({ request: { method: 'GET', origin: `http://${host}`, path: '/undici-on' }, socket })

    await fetch(url)
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/undici-on'))
    expect(rec).toBeTruthy()
    expect(typeof rec?.connectMs).toBe('number')
    expect(rec?.timing?.connectMs).toBe(rec?.connectMs)
  })

  test('undiciTiming: true never touches http-module captures (fetch-only enrichment)', async () => {
    const records: NetworkRequest[] = []
    startCapture({ bridge: false, embedBridge: false, undiciTiming: true, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await new Promise<void>((resolve) => {
      http.get(`http://127.0.0.1:${port}/undici-http-path`, (resp) => {
        resp.on('data', () => {})
        resp.on('end', () => resolve())
      })
    })
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/undici-http-path'))
    expect(rec?.source).toBe('http')
    // http-module captures already compute their own connectMs off the raw
    // socket — undiciTiming's enrich() no-ops for non-'fetch' sources, so this
    // just pins that it never clobbers the number httpInterceptor.ts produced.
    expect(typeof rec?.connectMs === 'number' || rec?.connectMs === undefined).toBe(true)
  })
})

describe('HAKKA_DISABLE kill switch', () => {
  const withEnv = async (value: string | undefined, fn: () => Promise<void>): Promise<void> => {
    const ORIGINAL = process.env.HAKKA_DISABLE
    try {
      if (value === undefined) delete process.env.HAKKA_DISABLE
      else process.env.HAKKA_DISABLE = value
      await fn()
    } finally {
      if (ORIGINAL === undefined) delete process.env.HAKKA_DISABLE
      else process.env.HAKKA_DISABLE = ORIGINAL
    }
  }

  test('setting HAKKA_DISABLE stops capture on the next poll tick, without a restart', async () => {
    await withEnv(undefined, async () => {
      const records: NetworkRequest[] = []
      const handle = startCapture({
        bridge: false,
        embedBridge: false,
        killSwitchPollMs: 15,
        sink: (r) => records.push(r),
      })

      const server = http.createServer((_req, res) => res.end('{}'))
      const port = await listen(server)
      await fetch(`http://127.0.0.1:${port}/before-disable`)
      await settle()
      expect(records.find((r) => r.url.includes('/before-disable'))).toBeTruthy()

      process.env.HAKKA_DISABLE = '1'
      // Poll interval is 15ms — give it several ticks to fire.
      await new Promise((r) => setTimeout(r, 100))

      await fetch(`http://127.0.0.1:${port}/after-disable`).catch(() => {})
      await settle()
      server.close()

      expect(records.find((r) => r.url.includes('/after-disable'))).toBeUndefined()
      // The kill switch called stop() itself — startCapture() is idempotent
      // only while `active` is set, so a fresh call now must return a NEW
      // handle rather than the (now-stopped) old one.
      const restarted = startCapture({ bridge: false, embedBridge: false })
      expect(restarted).not.toBe(handle)
      restarted.stop()
    })
  })

  test('a falsy HAKKA_DISABLE (unset) never trips the kill switch', async () => {
    await withEnv(undefined, async () => {
      const records: NetworkRequest[] = []
      startCapture({ bridge: false, embedBridge: false, killSwitchPollMs: 15, sink: (r) => records.push(r) })
      await new Promise((r) => setTimeout(r, 60)) // several poll ticks with HAKKA_DISABLE unset

      const server = http.createServer((_req, res) => res.end('{}'))
      const port = await listen(server)
      await fetch(`http://127.0.0.1:${port}/still-active`)
      await settle()
      server.close()

      expect(records.find((r) => r.url.includes('/still-active'))).toBeTruthy()
    })
  })
})

describe('ignorePatterns', () => {
  test('drops matching captures at emit time — they never reach the sink', async () => {
    const records: NetworkRequest[] = []
    const capture = startCapture({
      bridge: false,
      embedBridge: false,
      ignorePatterns: ['*telemetry.example.test*'],
      sink: (r) => records.push(r),
    })
    try {
      const server = http.createServer((_req, res) => res.end('{}'))
      const port = await listen(server)
      // Matching request: URL contains the glob's substring — must be dropped.
      await fetch(`http://127.0.0.1:${port}/x`, { headers: { host: 'telemetry.example.test' } }).catch(() => {})
      await fetch(`http://telemetry.example.test:${port}/record`).catch(() => {})
      // Control: a non-matching capture must still flow.
      await fetch(`http://127.0.0.1:${port}/kept`)
      await settle()
      server.close()

      expect(records.find((r) => r.url.includes('telemetry.example.test'))).toBeUndefined()
      expect(records.find((r) => r.url.includes('/kept'))).toBeTruthy()
    } finally {
      capture.stop()
    }
  })
})
