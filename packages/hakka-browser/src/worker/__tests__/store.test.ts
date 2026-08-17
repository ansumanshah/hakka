import type { NetworkRequest } from 'hakka-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { filterRequests, matchesQuery } from '../filter'
import { createStoreClient, type StoreClient } from '../storeClient'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: { 'content-type': 'application/json' },
    source: 'fetch',
    ...over,
  } as NetworkRequest
}

let client: StoreClient | null = null
afterEach(() => {
  client?.destroy()
  client = null
  vi.restoreAllMocks()
})

describe('worker/filter', () => {
  it('matches text over url + method', () => {
    const r = req({ url: 'https://a.com/orders', method: 'POST' })
    expect(matchesQuery(r, { text: 'orders' })).toBe(true)
    expect(matchesQuery(r, { text: 'post' })).toBe(true)
    expect(matchesQuery(r, { text: 'users' })).toBe(false)
  })

  it('matches status range, content-type, and method', () => {
    const r = req({ status: 404, method: 'GET', responseHeaders: { 'Content-Type': 'text/html' } })
    expect(matchesQuery(r, { statusRange: [400, 499] })).toBe(true)
    expect(matchesQuery(r, { statusRange: [200, 299] })).toBe(false)
    expect(matchesQuery(r, { contentType: 'html' })).toBe(true)
    expect(matchesQuery(r, { contentType: 'json' })).toBe(false)
    expect(matchesQuery(r, { method: 'get' })).toBe(true)
  })

  it('returns the input list untouched for an empty query', () => {
    const list = [req(), req()]
    expect(filterRequests(list, {})).toBe(list)
    expect(filterRequests(list)).toBe(list)
  })

  it('filters by runtime, treating untagged records as client', () => {
    const client = req() // no runtime → client
    const server = req({ runtime: 'server' })
    const edge = req({ runtime: 'edge' })
    expect(matchesQuery(client, { runtime: 'client' })).toBe(true)
    expect(matchesQuery(client, { runtime: 'server' })).toBe(false)
    expect(matchesQuery(server, { runtime: 'server' })).toBe(true)
    expect(filterRequests([client, server, edge], { runtime: 'server' })).toEqual([server])
  })
})

describe('worker/storeClient (in-process backend)', () => {
  it('reports the in-process backend', () => {
    client = createStoreClient({ forceInProcess: true })
    expect(client.usingWorker).toBe(false)
  })

  it('ingest then getSnapshot returns newest-first', async () => {
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req({ id: 'a' }))
    client.ingest(req({ id: 'b' }))
    expect((await client.getSnapshot()).map((r) => r.id)).toEqual(['b', 'a'])
  })

  it('getSnapshot honors a query (runs in the store)', async () => {
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req({ id: 'g', method: 'GET' }))
    client.ingest(req({ id: 'p', method: 'POST' }))
    expect((await client.getSnapshot({ method: 'POST' })).map((r) => r.id)).toEqual(['p'])
  })

  it('subscribe receives live ingests; unsubscribe stops them', () => {
    client = createStoreClient({ forceInProcess: true })
    const seen: string[] = []
    const off = client.subscribe((r) => seen.push(r.id))
    client.ingest(req({ id: 'x' }))
    off()
    client.ingest(req({ id: 'y' }))
    expect(seen).toEqual(['x'])
  })

  it('update enriches an existing request in place', async () => {
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req({ id: 'a', status: undefined }))
    client.update({ id: 'a', status: 200 })
    expect((await client.getSnapshot())[0]?.status).toBe(200)
  })

  it('applyResourceTiming correlates to a stored fetch by url + start time', async () => {
    client = createStoreClient({ forceInProcess: true })
    const t = Date.now()
    client.ingest(req({ id: 'a', url: 'https://x.com/p', source: 'fetch', startTime: t }))
    client.applyResourceTiming('https://x.com/p', t + 1, { dnsMs: 5, timing: { dnsMs: 5 } })
    expect((await client.getSnapshot())[0]?.timing?.dnsMs).toBe(5)
  })

  it('clear empties the store', async () => {
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req())
    client.clear()
    expect(await client.getSnapshot()).toEqual([])
  })

  it('exportHar and exportOtel serialize the buffer (off-thread in production)', async () => {
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req({ id: 'a' }))
    const har = await client.exportHar()
    expect(har).toContain('"log"')
    const otel = await client.exportOtel({ serviceName: 'test' })
    expect(() => JSON.parse(otel)).not.toThrow()
    expect(otel.length).toBeGreaterThan(2)
  })

  it('matchIds evaluates body-scoped queries against FULL records despite the slim mirror', async () => {
    // The regression this pins: under default slimEcho the main-thread mirror
    // never carries bodies, so a `body:` (or free-text 'all'-scope) token
    // evaluated against the mirror silently matches nothing. matchIds runs
    // the same query store-side, where the full records live.
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req({ id: 'with-secret', responseBody: '{"token":"tok_secret_42"}' }))
    client.ingest(req({ id: 'without' }))

    // Sanity: the mirror IS slim — the echo/snapshot would not match this.
    const snap = await client.getSnapshot()
    expect(snap.find((r) => r.id === 'with-secret')?.responseBody).toBeUndefined()

    const ids = await client.matchIds({
      tokens: [{ scope: 'body', mode: 'substring', value: 'tok_secret_42', negate: false }],
    })
    expect(ids).toEqual(['with-secret'])

    // Conjunction semantics hold in one engine: body token AND a non-matching
    // method must return nothing.
    const none = await client.matchIds({
      tokens: [{ scope: 'body', mode: 'substring', value: 'tok_secret_42', negate: false }],
      method: 'POST',
    })
    expect(none).toEqual([])
  })
})

describe('worker/storeClient — slimEcho (bodies off the main-thread mirror by default)', () => {
  it('subscribe echoes strip requestBody/responseBody, keeping sizes/headers/status', () => {
    client = createStoreClient({ forceInProcess: true })
    const seen: NetworkRequest[] = []
    client.subscribe((r) => seen.push(r))
    client.ingest(
      req({
        id: 'slim-1',
        requestBody: '{"a":1}',
        responseBody: '{"ok":true}',
        requestBodySize: 7,
        responseBodySize: 10,
      }),
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]?.requestBody).toBeUndefined()
    expect(seen[0]?.responseBody).toBeUndefined()
    // Everything else survives untouched.
    expect(seen[0]?.requestBodySize).toBe(7)
    expect(seen[0]?.responseBodySize).toBe(10)
    expect(seen[0]?.responseHeaders?.['content-type']).toBe('application/json')
  })

  it('getSnapshot is slim too — the same mirror backs the history backfill on mount', async () => {
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req({ id: 'slim-2', requestBody: 'x', responseBody: 'y' }))
    const snap = await client.getSnapshot()
    expect(snap[0]?.requestBody).toBeUndefined()
    expect(snap[0]?.responseBody).toBeUndefined()
  })

  it('getBody/getBodies still return the real bytes, full-fidelity, regardless of slimEcho', async () => {
    client = createStoreClient({ forceInProcess: true })
    client.ingest(req({ id: 'slim-3', requestBody: '{"a":1}', responseBody: '{"ok":true}' }))
    client.ingest(req({ id: 'slim-4', responseBody: 'plain text' }))

    expect(await client.getBody('slim-3')).toEqual({ requestBody: '{"a":1}', responseBody: '{"ok":true}' })
    expect(await client.getBody('missing-id')).toBeNull()

    const bodies = await client.getBodies(['slim-3', 'slim-4', 'missing-id'])
    expect(bodies.get('slim-3')).toEqual({ requestBody: '{"a":1}', responseBody: '{"ok":true}' })
    expect(bodies.get('slim-4')).toEqual({ requestBody: null, responseBody: 'plain text' })
    expect(bodies.has('missing-id')).toBe(false)
  })

  it('slimEcho: false restores full bodies on both the live echo and getSnapshot', async () => {
    client = createStoreClient({ forceInProcess: true, config: { slimEcho: false } })
    const seen: NetworkRequest[] = []
    client.subscribe((r) => seen.push(r))
    client.ingest(req({ id: 'full-1', requestBody: '{"a":1}', responseBody: '{"ok":true}' }))

    expect(seen[0]?.requestBody).toBe('{"a":1}')
    expect(seen[0]?.responseBody).toBe('{"ok":true}')

    const snap = await client.getSnapshot()
    expect(snap[0]?.requestBody).toBe('{"a":1}')
    expect(snap[0]?.responseBody).toBe('{"ok":true}')
  })
})
