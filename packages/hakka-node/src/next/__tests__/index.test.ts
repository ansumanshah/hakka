import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import type { NetworkRequest } from 'hakka-core'

import { stopEdgeCapture } from '../edgeCapture'
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

  test('warns once in development when no sink is configured', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    process.env.NODE_ENV = 'development'

    await register()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('no `options.sink` was configured')
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
