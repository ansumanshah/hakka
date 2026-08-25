import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

// See spanProcessor.test.ts's header comment — devDependency only, exercised
// the same way a consumer with the optional peer installed would be.
import { trace as otelTrace } from '@opentelemetry/api'
import type { NetworkRequest } from 'hakka-core'

import { register, startServerCapture, stopServerCapture } from '../serverCapture'

afterEach(() => stopServerCapture())

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

const settle = () => new Promise((r) => setTimeout(r, 25))

/**
 * `hakka-node/next`'s serverCapture is a thin wrapper around the
 * framework-agnostic capture one directory up — the bulk of the
 * capture/interceptor/trace test matrix (fetch/http tagging, embedded-hub
 * relay, trace correlation, traceparent fallback) lives in
 * `packages/hakka-node/src/serverCapture.test.ts` and is not repeated here.
 * These tests cover only what's specific to this wrapper: the
 * `NEXT_RUNTIME` branching in `register()` and the idempotent singleton it
 * shares with `startServerCapture`.
 */
describe('startServerCapture', () => {
  test('tags fetch captures with runtime: server (delegates to hakka-node)', async () => {
    const records: NetworkRequest[] = []
    startServerCapture({ bridge: false, sink: (r) => records.push(r) })

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

  test('honors a custom runtime tag (edge) and is idempotent', async () => {
    const records: NetworkRequest[] = []
    const a = startServerCapture({ bridge: false, runtime: 'edge', sink: (r) => records.push(r) })
    const b = startServerCapture({ bridge: false, runtime: 'edge' })
    expect(a).toBe(b) // idempotent — second call returns the live handle

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/edge`)
    await settle()
    server.close()
    expect(records.find((r) => r.url.includes('/edge'))?.runtime).toBe('edge')
  })
})

describe('cacheStatus annotation', () => {
  test('sets cacheStatus from x-nextjs-cache on a captured fetch', async () => {
    const records: NetworkRequest[] = []
    startServerCapture({ bridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'x-nextjs-cache': 'HIT' })
      res.end('{}')
    })
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/cached`)
    await settle()
    server.close()

    expect(records.find((r) => r.url.includes('/cached'))?.cacheStatus).toBe('HIT')
  })

  test('falls back to x-vercel-cache when x-nextjs-cache is absent', async () => {
    const records: NetworkRequest[] = []
    startServerCapture({ bridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'x-vercel-cache': 'STALE' })
      res.end('{}')
    })
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/vercel-cached`)
    await settle()
    server.close()

    expect(records.find((r) => r.url.includes('/vercel-cached'))?.cacheStatus).toBe('STALE')
  })

  test('sets cacheStatus to STALE, passed through unchanged (widened doc comment, same annotateCacheStatus code)', async () => {
    const records: NetworkRequest[] = []
    startServerCapture({ bridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'x-nextjs-cache': 'STALE' })
      res.end('{}')
    })
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/stale`)
    await settle()
    server.close()

    expect(records.find((r) => r.url.includes('/stale'))?.cacheStatus).toBe('STALE')
  })

  test('passes an arbitrary framework-specific value (e.g. REVALIDATE) through unchanged — cacheStatus is a plain string, not a fixed union', async () => {
    const records: NetworkRequest[] = []
    startServerCapture({ bridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'x-vercel-cache': 'REVALIDATE' })
      res.end('{}')
    })
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/revalidate`)
    await settle()
    server.close()

    expect(records.find((r) => r.url.includes('/revalidate'))?.cacheStatus).toBe('REVALIDATE')
  })

  test('leaves cacheStatus unset when no cache header is present, and still calls a caller-supplied sink', async () => {
    const records: NetworkRequest[] = []
    startServerCapture({ bridge: false, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/uncached`)
    await settle()
    server.close()

    const rec = records.find((r) => r.url.includes('/uncached'))
    expect(rec).toBeTruthy()
    expect(rec?.cacheStatus).toBeUndefined()
  })
})

describe('traceSpans defaulting', () => {
  /** Registers a fake concrete provider behind the ProxyTracerProvider delegate — see spanProcessor.test.ts. */
  function registerFakeProvider(addSpanProcessor: (p: unknown) => void): void {
    otelTrace.setGlobalTracerProvider({ getTracer: () => ({}), addSpanProcessor } as never)
  }

  test('defaults traceSpans to true in development — a registered OTel provider gets a span processor attached', async () => {
    const ORIGINAL_ENV = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    delete process.env.NEXT_OTEL_VERBOSE
    let attached: unknown
    registerFakeProvider((p) => {
      attached = p
    })
    try {
      startServerCapture({ bridge: false })
      await settle()
      expect(attached).toBeDefined()
      // enableTraceSpans only sets this once it has actually attached — the
      // clearest externally-observable signal that traceSpans was on.
      expect(process.env.NEXT_OTEL_VERBOSE).toBe('1')
    } finally {
      otelTrace.disable()
      delete process.env.NEXT_OTEL_VERBOSE
      if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = ORIGINAL_ENV
    }
  })

  test('an explicit traceSpans: false overrides the development default', async () => {
    const ORIGINAL_ENV = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    delete process.env.NEXT_OTEL_VERBOSE
    let attached: unknown
    registerFakeProvider((p) => {
      attached = p
    })
    try {
      startServerCapture({ bridge: false, traceSpans: false })
      await settle()
      expect(attached).toBeUndefined()
      expect(process.env.NEXT_OTEL_VERBOSE).toBeUndefined()
    } finally {
      otelTrace.disable()
      delete process.env.NEXT_OTEL_VERBOSE
      if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = ORIGINAL_ENV
    }
  })
})

describe('register — NEXT_RUNTIME branching', () => {
  test('register() with no NEXT_RUNTIME set captures fetch tagged server (plain Node fallback)', async () => {
    const records: NetworkRequest[] = []
    await register({ bridge: false, sink: (r) => records.push(r) })
    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/reg`)
    await settle()
    server.close()
    expect(records.find((r) => r.url.includes('/reg'))?.runtime).toBe('server')
  })

  test('register() on the edge runtime forces captureHttp:false and embedBridge:false', async () => {
    const ORIGINAL = process.env.NEXT_RUNTIME
    process.env.NEXT_RUNTIME = 'edge'
    try {
      const records: NetworkRequest[] = []
      await register({ bridge: false, sink: (r) => records.push(r) })

      const server = http.createServer((_req, res) => res.end('{}'))
      const port = await listen(server)
      // fetch is still captured on the edge runtime…
      await fetch(`http://127.0.0.1:${port}/edge-fetch`)
      // …but raw http.request is NOT (captureHttp:false).
      await new Promise<void>((resolve) => {
        http.get(`http://127.0.0.1:${port}/edge-http`, (resp) => {
          resp.on('data', () => {})
          resp.on('end', () => resolve())
        })
      })
      await settle()
      server.close()

      const fetchRec = records.find((r) => r.url.includes('/edge-fetch'))
      expect(fetchRec?.runtime).toBe('edge')
      expect(records.find((r) => r.url.includes('/edge-http'))).toBeUndefined()
    } finally {
      if (ORIGINAL === undefined) delete process.env.NEXT_RUNTIME
      else process.env.NEXT_RUNTIME = ORIGINAL
    }
  })

  test('register() no-ops in production unless a runtime is explicitly passed', async () => {
    const ORIGINAL = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const records: NetworkRequest[] = []
      await register({ bridge: false, sink: (r) => records.push(r) })
      const server = http.createServer((_req, res) => res.end('{}'))
      const port = await listen(server)
      await fetch(`http://127.0.0.1:${port}/prod-noop`)
      await settle()
      server.close()
      expect(records.length).toBe(0)
      stopServerCapture()

      // Passing an explicit runtime opts back in even in production.
      const records2: NetworkRequest[] = []
      await register({ bridge: false, runtime: 'server', sink: (r) => records2.push(r) })
      const server2 = http.createServer((_req, res) => res.end('{}'))
      const port2 = await listen(server2)
      await fetch(`http://127.0.0.1:${port2}/prod-explicit`)
      await settle()
      server2.close()
      expect(records2.find((r) => r.url.includes('/prod-explicit'))).toBeTruthy()
    } finally {
      if (ORIGINAL === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = ORIGINAL
    }
  })

  test('register() also honors options.force in production, matching the main hakka-node entry', async () => {
    const ORIGINAL = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const records: NetworkRequest[] = []
      // No `runtime` passed — only `force`. Mirrors `HakkaNodeOptions.force`
      // on the main `hakka-node` entry, which this wrapper otherwise ignores.
      await register({ bridge: false, force: true, sink: (r) => records.push(r) })
      const server = http.createServer((_req, res) => res.end('{}'))
      const port = await listen(server)
      await fetch(`http://127.0.0.1:${port}/prod-forced`)
      await settle()
      server.close()
      expect(records.find((r) => r.url.includes('/prod-forced'))).toBeTruthy()
    } finally {
      if (ORIGINAL === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = ORIGINAL
    }
  })
})
