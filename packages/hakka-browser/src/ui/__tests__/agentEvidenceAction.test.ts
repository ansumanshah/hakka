/**
 * copyAgentContextForRequest is the shared main-thread assembly behind
 * Detail's "Copy as agent context" button and RequestRow's kebab item.
 * Exercises the real in-process StoreClient (bodies/spans) plus the real
 * hakka-core `logStore` singleton. `copyToClipboard` is mocked so these
 * tests assert on the exact formatted payload instead of depending on a
 * jsdom/happy-dom clipboard shim.
 */
import type { FrameworkSpan, NetworkRequest } from 'hakka-core'
import { logStore } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { copyToClipboard } from '../../adapters/clipboard'
import { createStoreClient, type StoreClient } from '../../worker/storeClient'
import { copyAgentContextForRequest } from '../agentEvidenceAction'

vi.mock('../../adapters/clipboard', () => ({
  copyToClipboard: vi.fn(async () => true),
}))

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

let client: StoreClient

beforeEach(() => {
  client = createStoreClient({ forceInProcess: true })
  logStore.clear()
  vi.mocked(copyToClipboard).mockClear()
})

afterEach(() => {
  client.destroy()
})

describe('copyAgentContextForRequest', () => {
  it('copies a bundle containing the focal request when it has no correlationId', async () => {
    const r = req({ id: 'solo', url: 'https://api.example.com/checkout', status: 500, error: 'boom' })
    client.ingest(r)

    const ok = await copyAgentContextForRequest(client, r)

    expect(ok).toBe(true)
    expect(copyToClipboard).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    expect(payload).toContain('```json')
    const jsonStart = payload.indexOf('```json') + '```json'.length
    const jsonEnd = payload.lastIndexOf('```')
    const bundle = JSON.parse(payload.slice(jsonStart, jsonEnd)) as {
      focusRequestId: string
      requests: { id: string }[]
    }
    expect(bundle.focusRequestId).toBe('solo')
    expect(bundle.requests.map((x) => x.id)).toEqual(['solo'])
  })

  it('groups by correlationId — a correlated hop pulls in its siblings', async () => {
    const now = Date.now()
    // startTime: 0 (epoch) gets evicted immediately by the store's
    // age-based retention policy, so use near-now timestamps.
    const a = req({ id: 'a', url: 'https://api.example.com/orders', correlationId: 'trace-1', startTime: now })
    const b = req({
      id: 'b',
      url: 'https://api.example.com/orders/items',
      correlationId: 'trace-1',
      startTime: now + 5,
    })
    const unrelated = req({
      id: 'c',
      url: 'https://api.example.com/other',
      correlationId: 'trace-2',
      startTime: now + 1,
    })
    client.ingest(a)
    client.ingest(b)
    client.ingest(unrelated)

    await copyAgentContextForRequest(client, b)

    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    const bundle = JSON.parse(payload.slice(payload.indexOf('```json') + 7, payload.lastIndexOf('```'))) as {
      focusRequestId: string
      requests: { id: string }[]
    }
    expect(bundle.focusRequestId).toBe('b')
    expect(bundle.requests.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })

  it('hydrates bodies from the store batch RPC (slim mirror gets the real bytes)', async () => {
    const r = req({ id: 'body-1', requestBody: undefined, responseBody: undefined })
    client.ingest(r)
    // Simulates the slimEcho path: real bytes landing after ingest, the same
    // way the worker backend updates the record in place.
    client.update({ id: 'body-1', requestBody: 'q=1', responseBody: '{"ok":true}' })

    await copyAgentContextForRequest(client, { ...r, id: 'body-1' })

    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    const bundle = JSON.parse(payload.slice(payload.indexOf('```json') + 7, payload.lastIndexOf('```'))) as {
      requests: { id: string; responseBody?: string | null }[]
    }
    expect(bundle.requests[0]?.responseBody).toBe('{"ok":true}')
  })

  it('includes real console entries from the main-thread logStore singleton', async () => {
    const r = req({ id: 'log-1' })
    client.ingest(r)
    logStore.add({ id: 'log-entry-1', level: 'error', message: 'boom happened', timestamp: r.startTime })

    await copyAgentContextForRequest(client, r)

    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    const bundle = JSON.parse(payload.slice(payload.indexOf('```json') + 7, payload.lastIndexOf('```'))) as {
      console: { message: string }[]
    }
    expect(bundle.console.some((entry) => entry.message === 'boom happened')).toBe(true)
  })

  it('passes correlated spans through to the bundle trace', async () => {
    const r = req({ id: 'span-1', correlationId: 'trace-span' })
    client.ingest(r)
    const span: FrameworkSpan = {
      id: 'span-a',
      traceId: 'trace-span',
      parentId: null,
      name: 'BaseServer.handleRequest',
      startTime: r.startTime,
      endTime: r.startTime + 10,
      verbosity: 'primary',
      runtime: 'server',
    }
    // Real span ingestion only happens through the bridge-relay path (covered
    // in storeEngine.bridge.test.ts); this isolates the one thing
    // agentEvidenceAction owns — a resolved getSpansForTrace result reaching
    // the bundle — via a thin override (client's methods are plain closures
    // with no `this`, so spreading is safe).
    const spanClient: StoreClient = { ...client, getSpansForTrace: async () => [span] }

    await copyAgentContextForRequest(spanClient, r)

    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    const bundle = JSON.parse(payload.slice(payload.indexOf('```json') + 7, payload.lastIndexOf('```'))) as {
      trace: { bars: { kind: string }[] }
    }
    expect(bundle.trace.bars.some((b) => b.kind === 'span')).toBe(true)
  })

  it('returns false when clipboard write fails, without throwing', async () => {
    vi.mocked(copyToClipboard).mockResolvedValueOnce(false)
    const r = req({ id: 'fail-1' })
    client.ingest(r)

    await expect(copyAgentContextForRequest(client, r)).resolves.toBe(false)
  })

  it('scrubs a secret out of the clipboard payload by default', async () => {
    const SECRET = 'sk-live-abcdef0123456789'
    const r = req({
      id: 'secret-1',
      url: `https://api.example.com/chat?api_key=${SECRET}`,
      requestHeaders: { Authorization: `Bearer ${SECRET}`, Cookie: `session=${SECRET}` },
      requestBody: JSON.stringify({ password: SECRET, nested: { token: SECRET } }),
    })
    client.ingest(r)

    await copyAgentContextForRequest(client, r)

    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    expect(payload).not.toContain(SECRET)
    expect(payload).toContain('Scrubbed before sharing')
  })

  it('{ scrub: false } opts out and the secret survives', async () => {
    const SECRET = 'sk-live-abcdef0123456789'
    const r = req({ id: 'secret-2', requestBody: JSON.stringify({ password: SECRET }) })
    client.ingest(r)

    await copyAgentContextForRequest(client, r, { scrub: false })

    const payload = vi.mocked(copyToClipboard).mock.calls[0]![0]
    expect(payload).toContain(SECRET)
  })
})
