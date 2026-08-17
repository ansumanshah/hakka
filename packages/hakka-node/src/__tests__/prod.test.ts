import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import type { NetworkRequest } from 'hakka-core'

import { createPullHandler, startProdCapture, stopProdCapture, type ProdCaptureHandle } from '../prod'
import { runInTraceContext } from '../trace'

afterEach(() => stopProdCapture())

function listen(server: Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)),
  )
}

const settle = () => new Promise((r) => setTimeout(r, 25))

describe('startProdCapture — required allowlist', () => {
  test('throws when captureUrls is missing', () => {
    // @ts-expect-error — exercising the runtime guard for a missing required field
    expect(() => startProdCapture({})).toThrow(/captureUrls/)
  })

  test('throws when captureUrls is an empty array', () => {
    expect(() => startProdCapture({ captureUrls: [] })).toThrow(/captureUrls/)
  })

  test('does not leave a half-started capture behind after throwing', () => {
    expect(() => startProdCapture({ captureUrls: [] })).toThrow()
    // A subsequent, valid call must start a fresh capture, not return some
    // partially-initialized handle from the failed call.
    const capture = startProdCapture({ captureUrls: ['http://example.test/*'] })
    expect(capture.getRecords()).toEqual([])
  })
})

describe('startProdCapture — cohort AND URL-allowlist gating', () => {
  test('captures only requests that are BOTH in the debug cohort AND URL-allowlisted', async () => {
    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    const base = `http://127.0.0.1:${port}`

    const capture = startProdCapture({ captureUrls: [`${base}/api/*`] })

    // (a) debug cohort + matching URL → captured
    await runInTraceContext({ traceId: 'T-A', debug: true }, () => fetch(`${base}/api/users`))
    // (b) debug cohort but URL NOT on the allowlist → not captured
    await runInTraceContext({ traceId: 'T-B', debug: true }, () => fetch(`${base}/other/path`))
    // (c) URL matches, but no debug cohort at all → not captured
    await fetch(`${base}/api/orders`)
    // (d) explicit debug: false → not captured
    await runInTraceContext({ traceId: 'T-D', debug: false }, () => fetch(`${base}/api/carts`))

    await settle()
    server.close()

    const urls = capture.getRecords().map((r) => r.url)
    expect(urls.some((u) => u.includes('/api/users'))).toBe(true)
    expect(urls.some((u) => u.includes('/other/path'))).toBe(false)
    expect(urls.some((u) => u.includes('/api/orders'))).toBe(false)
    expect(urls.some((u) => u.includes('/api/carts'))).toBe(false)
  })

  test('tags captured records with runtime: server by default', async () => {
    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    const capture = startProdCapture({ captureUrls: [`http://127.0.0.1:${port}/*`] })

    await runInTraceContext({ traceId: 'T', debug: true }, () => fetch(`http://127.0.0.1:${port}/x`))
    await settle()
    server.close()

    expect(capture.getRecords()[0]?.runtime).toBe('server')
  })

  test('is idempotent — a second call while active returns the first handle', () => {
    const a = startProdCapture({ captureUrls: ['http://example.test/*'] })
    const b = startProdCapture({ captureUrls: ['http://different.test/*'] })
    expect(a).toBe(b)
  })

  test('stop() tears down interceptors — a subsequent cohort request is no longer captured', async () => {
    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    const base = `http://127.0.0.1:${port}`
    const capture = startProdCapture({ captureUrls: [`${base}/*`] })

    await runInTraceContext({ traceId: 'T-BEFORE', debug: true }, () => fetch(`${base}/before-stop`))
    await settle()
    expect(capture.getRecords().some((r) => r.url.includes('/before-stop'))).toBe(true)

    capture.stop()

    await runInTraceContext({ traceId: 'T-AFTER', debug: true }, () => fetch(`${base}/after-stop`).catch(() => {}))
    await settle()
    server.close()

    // The (now-stopped) handle's own buffer must not have grown.
    expect(capture.getRecords().some((r) => r.url.includes('/after-stop'))).toBe(false)
  })
})

describe('startProdCapture — ring buffer bound', () => {
  test('getRecords() is bounded by maxRecords and ordered oldest → newest', async () => {
    const server = http.createServer((_req, res) => res.end('{}'))
    const port = await listen(server)
    const base = `http://127.0.0.1:${port}`
    const capture = startProdCapture({ captureUrls: [`${base}/*`], maxRecords: 2 })

    await runInTraceContext({ traceId: 'T', debug: true }, async () => {
      await fetch(`${base}/one`)
      await fetch(`${base}/two`)
      await fetch(`${base}/three`)
    })
    await settle()
    server.close()

    const records = capture.getRecords()
    expect(records).toHaveLength(2)
    // Oldest of the three ('/one') was evicted; remaining two are oldest→newest.
    expect(records[0]?.url.includes('/two')).toBe(true)
    expect(records[1]?.url.includes('/three')).toBe(true)
  })
})

describe('createPullHandler', () => {
  function fakeCapture(records: NetworkRequest[]): Pick<ProdCaptureHandle, 'getRecords'> {
    return { getRecords: () => records }
  }

  const record = (over: Partial<NetworkRequest>): NetworkRequest => ({
    id: 'r1',
    url: 'http://x/y',
    method: 'GET',
    startTime: 0,
    ...over,
  })

  test('401s without an Authorization header', async () => {
    const handler = createPullHandler({ capture: fakeCapture([]), token: 'secret' })
    const res = await handler(new Request('http://localhost/pull'))
    expect(res.status).toBe(401)
  })

  test('401s with a mismatched bearer token', async () => {
    const handler = createPullHandler({ capture: fakeCapture([]), token: 'secret' })
    const res = await handler(new Request('http://localhost/pull', { headers: { authorization: 'Bearer wrong' } }))
    expect(res.status).toBe(401)
  })

  test('401s with a token of different length than expected (constant-time path)', async () => {
    const handler = createPullHandler({ capture: fakeCapture([]), token: 'a-fairly-long-secret-token' })
    const res = await handler(new Request('http://localhost/pull', { headers: { authorization: 'Bearer short' } }))
    expect(res.status).toBe(401)
  })

  test('200s with the correct bearer token and returns records as JSON', async () => {
    const records = [record({ id: 'a', url: 'http://x/a' })]
    const handler = createPullHandler({ capture: fakeCapture(records), token: 'secret' })
    const res = await handler(new Request('http://localhost/pull', { headers: { authorization: 'Bearer secret' } }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as { records: NetworkRequest[] }
    expect(body.records).toHaveLength(1)
    expect(body.records[0]?.id).toBe('a')
  })

  test('?since=<ms> returns only records strictly newer than it', async () => {
    const records = [record({ id: 'old', startTime: 100 }), record({ id: 'new', startTime: 200 })]
    const handler = createPullHandler({ capture: fakeCapture(records), token: 't' })
    const res = await handler(
      new Request('http://localhost/pull?since=100', { headers: { authorization: 'Bearer t' } }),
    )
    const body = (await res.json()) as { records: NetworkRequest[] }
    expect(body.records.map((r) => r.id)).toEqual(['new'])
  })

  test('?user=<prefix> filters by correlationId prefix', async () => {
    const records = [
      record({ id: 'a', correlationId: 'alice-session-1' }),
      record({ id: 'b', correlationId: 'bob-session-1' }),
    ]
    const handler = createPullHandler({ capture: fakeCapture(records), token: 't' })
    const res = await handler(
      new Request('http://localhost/pull?user=alice-', { headers: { authorization: 'Bearer t' } }),
    )
    const body = (await res.json()) as { records: NetworkRequest[] }
    expect(body.records.map((r) => r.id)).toEqual(['a'])
  })
})
