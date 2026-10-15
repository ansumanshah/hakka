import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import type { NetworkRequest } from 'hakka-core'

import { startEdgeCapture, stopEdgeCapture } from '../edgeCapture'
import { EDGE_RELAY_PATH } from '../edgeRelay'
import { register } from '../index'

/**
 * `register()`'s `NEXT_RUNTIME === 'nodejs'` branch (dynamic `import('./server')`,
 * full capture) is exercised end-to-end by `serverCapture.test.ts` — this file
 * covers only the Edge branch: real fetch capture via `./edgeCapture`, not the
 * silent (nor merely warned) no-op it used to be.
 */
let warn: ReturnType<typeof mock>
let originalWarn: typeof console.warn
let originalNextRuntime: string | undefined
let originalNodeEnv: string | undefined

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

const settle = () => new Promise((r) => setTimeout(r, 25))

beforeEach(() => {
  warn = mock(() => {})
  originalWarn = console.warn
  console.warn = warn as unknown as typeof console.warn
  originalNextRuntime = process.env.NEXT_RUNTIME
  originalNodeEnv = process.env.NODE_ENV
})

afterEach(() => {
  console.warn = originalWarn
  if (originalNextRuntime === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = originalNextRuntime
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
  stopEdgeCapture()
})

describe('register — Edge runtime branch', () => {
  test('a stopped Edge handle cannot stop a later capture', async () => {
    const first = startEdgeCapture()
    first.stop()
    const records: NetworkRequest[] = []
    const second = startEdgeCapture({ sink: (r) => records.push(r) })
    first.stop()
    expect(startEdgeCapture()).toBe(second)
    const server = http.createServer((_req, res) => res.end('ok'))
    const port = await listen(server)
    try {
      await fetch(`http://127.0.0.1:${port}/edge-restarted`)
      await settle()
      expect(records.some((r) => r.url.endsWith('/edge-restarted'))).toBe(true)
    } finally {
      server.close()
    }
  })

  test.each([{ captureFetch: false }, { sampleRate: 0 }, { shouldCapture: () => false }])(
    'honors Edge pre-capture options: %j',
    async (gate) => {
      process.env.NEXT_RUNTIME = 'edge'
      process.env.NODE_ENV = 'development'
      const records: NetworkRequest[] = []
      await register({ ...gate, sink: (r) => records.push(r) })
      const server = http.createServer((_req, res) => res.end('ok'))
      const port = await listen(server)
      try {
        await fetch(`http://127.0.0.1:${port}/edge-gated`)
        await settle()
        expect(records).toHaveLength(0)
      } finally {
        server.close()
      }
    },
  )

  test('captures fetch and forwards records to options.sink', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    process.env.NODE_ENV = 'development'

    const records: NetworkRequest[] = []
    await register({ sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/edge-fetch`)
    await settle()
    server.close()

    expect(records.some((r) => r.url.includes('/edge-fetch'))).toBe(true)
    expect(records[0]?.runtime).toBe('edge')
    // A sink was configured, so the "records are discarded" warning must not fire.
    expect(warn).not.toHaveBeenCalled()
  })

  describe('with no sink configured', () => {
    let relay: Server
    let relayPosts: NetworkRequest[]
    let relayStatus: number
    let originalOrigin: string | undefined

    beforeEach(async () => {
      relayPosts = []
      relayStatus = 202
      relay = http.createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          if (req.url === EDGE_RELAY_PATH && relayStatus === 202) relayPosts.push(JSON.parse(body) as NetworkRequest)
          res.statusCode = req.url === EDGE_RELAY_PATH ? relayStatus : 200
          res.end('{}')
        })
      })
      const port = await listen(relay)
      originalOrigin = process.env.HAKKA_EDGE_RELAY_ORIGIN
      process.env.HAKKA_EDGE_RELAY_ORIGIN = `http://127.0.0.1:${port}`
    })

    afterEach(() => {
      relay.close()
      if (originalOrigin === undefined) delete process.env.HAKKA_EDGE_RELAY_ORIGIN
      else process.env.HAKKA_EDGE_RELAY_ORIGIN = originalOrigin
    })

    test('development relays Edge records to the relay route, never the relay request itself', async () => {
      process.env.NEXT_RUNTIME = 'edge'
      process.env.NODE_ENV = 'development'
      await register()

      await fetch(`${process.env.HAKKA_EDGE_RELAY_ORIGIN}/edge-app-call`)
      await settle()

      // The interceptor emits a pending and a settled record per request (same id); the hub upserts by id.
      expect(new Set(relayPosts.map((r) => r.id)).size).toBe(1)
      expect(relayPosts.every((r) => r.url.endsWith('/edge-app-call') && r.runtime === 'edge')).toBe(true)
      expect(warn).not.toHaveBeenCalled()
    })

    test('warns once when the relay route is missing', async () => {
      process.env.NEXT_RUNTIME = 'edge'
      process.env.NODE_ENV = 'development'
      relayStatus = 404
      await register()

      await fetch(`${process.env.HAKKA_EDGE_RELAY_ORIGIN}/first`)
      await fetch(`${process.env.HAKKA_EDGE_RELAY_ORIGIN}/second`)
      await settle()

      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toContain('createEdgeRelayHandler')
    })

    test('a forced production capture does not relay unless a sink is passed', async () => {
      process.env.NEXT_RUNTIME = 'edge'
      process.env.NODE_ENV = 'production'
      await register({ force: true })

      await fetch(`${process.env.HAKKA_EDGE_RELAY_ORIGIN}/prod-call`)
      await settle()

      expect(relayPosts).toHaveLength(0)
    })
  })

  test('stays silent AND does not start capture in production, with no runtime/force', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    process.env.NODE_ENV = 'production'

    const records: NetworkRequest[] = []
    await register({ sink: (r) => records.push(r) })
    expect(warn).not.toHaveBeenCalled()

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/prod-noop`)
    await settle()
    server.close()

    expect(records).toHaveLength(0)
  })

  test('captures in production when options.force is set, matching the main hakka-node entry', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    process.env.NODE_ENV = 'production'

    const records: NetworkRequest[] = []
    await register({ force: true, sink: (r) => records.push(r) })

    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    await fetch(`http://127.0.0.1:${port}/prod-forced`)
    await settle()
    server.close()

    expect(records.some((r) => r.url.includes('/prod-forced'))).toBe(true)
  })

  test('does not warn or capture at all outside the Edge runtime', async () => {
    delete process.env.NEXT_RUNTIME
    process.env.NODE_ENV = 'development'

    await register()

    expect(warn).not.toHaveBeenCalled()
  })
})
