import { afterEach, describe, expect, test } from 'bun:test'
import http from 'node:http'
import type { Server } from 'node:http'

import { configureBodyRedaction, getBodyRedactionFields, type NetworkRequest } from 'hakka-core'

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

describe('startProdCapture — body redaction defaults', () => {
  /**
   * Body-field redaction is a process-global in hakka-core that no-ops on an
   * empty list, and nothing in this package configured one — so following the
   * documented prod setup captured passwords and tokens verbatim out of real
   * users' traffic. Prod inverts the default the same way `captureUrls` is
   * required rather than optional.
   */
  test('redacts credential-shaped body fields with no configuration', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => res.end('{}'))
    })
    const port = await listen(server)
    const base = `http://127.0.0.1:${port}`
    const capture = startProdCapture({ captureUrls: [`${base}/*`] })

    await runInTraceContext({ traceId: 'T', debug: true }, () =>
      fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 'ada', password: 'hunter2-secret', nested: { apiKey: 'sk-live-x' } }),
      }),
    )
    await settle()
    server.close()

    const bodies = capture.getRecords().map((r) => r.requestBody ?? '')
    expect(bodies.join('')).not.toContain('hunter2-secret')
    expect(bodies.join('')).not.toContain('sk-live-x')
    // Non-sensitive fields must survive, or the capture is useless.
    expect(bodies.join('')).toContain('ada')
  })

  test('an explicit empty list opts back into verbatim bodies', async () => {
    const server = http.createServer((req, res) => {
      req.on('data', () => {})
      req.on('end', () => res.end('{}'))
    })
    const port = await listen(server)
    const base = `http://127.0.0.1:${port}`
    const capture = startProdCapture({ captureUrls: [`${base}/*`], redactBodyFields: [] })

    await runInTraceContext({ traceId: 'T', debug: true }, () =>
      fetch(`${base}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'hunter2-secret' }),
      }),
    )
    await settle()
    server.close()

    expect(
      capture
        .getRecords()
        .map((r) => r.requestBody ?? '')
        .join(''),
    ).toContain('hunter2-secret')
  })

  test('stopping restores the previous global field list', () => {
    configureBodyRedaction(['preexisting'])

    const capture = startProdCapture({ captureUrls: ['http://x/*'] })
    expect(getBodyRedactionFields()).toContain('password')
    capture.stop()

    expect(getBodyRedactionFields()).toEqual(['preexisting'])
    configureBodyRedaction([])
  })
})

describe('createPullHandler — misconfiguration', () => {
  /**
   * The documented setup passes `process.env.HAKKA_PULL_TOKEN!`. When that env
   * var is unset the token is `undefined` at runtime despite the type, and
   * `Buffer.from(undefined)` threw out of the handler — a 500 where the
   * operator needed a 401. A token that cannot be satisfied must refuse, not
   * crash.
   */
  test('an unset token 401s rather than throwing', async () => {
    const capture = startProdCapture({ captureUrls: ['http://x/*'] })
    const handler = createPullHandler({ capture, token: undefined as unknown as string })

    const res = await handler(new Request('http://localhost/pull', { headers: { authorization: 'Bearer t' } }))

    expect(res.status).toBe(401)
  })

  test('an empty token 401s rather than matching an empty header', async () => {
    const capture = startProdCapture({ captureUrls: ['http://x/*'] })
    const handler = createPullHandler({ capture, token: '' })

    const res = await handler(new Request('http://localhost/pull', { headers: { authorization: 'Bearer ' } }))

    expect(res.status).toBe(401)
  })
})
