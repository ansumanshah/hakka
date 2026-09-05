import { beforeEach, describe, expect, it } from 'bun:test'

/**
 * The three read tools an agent reaches for first — `list_requests`,
 * `get_request`, `search_requests` — had no coverage beyond appearing in the
 * `tools/list` name check. They are the AI-facing API, so they are tested
 * through the real MCP protocol (server + client over `InMemoryTransport`)
 * rather than by calling the handlers directly: an agent sees the wire result,
 * not the function's return value.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ControlCommand, NetworkRequest } from 'hakka-core'

import { RequestStore } from '../RequestStore.js'
import { SpanStore } from '../SpanStore.js'
import { registerTools, type ControlSender } from '../tools/index.js'

class SilentSender implements ControlSender {
  send(_command: ControlCommand): void {}
}

let idSeq = 0
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idSeq++
  return {
    id: `req-${idSeq}`,
    url: `https://api.example.com/resource/${idSeq}`,
    method: 'GET',
    status: 200,
    startTime: idSeq,
    duration: 100,
    requestHeaders: {},
    responseHeaders: {},
    ...overrides,
  }
}

let store: RequestStore
let client: Client
let closeAll: () => Promise<void>

/** The parsed payload of a tool call — what an agent actually reads. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { text: string }[]
    isError?: boolean
  }
  return { ...JSON.parse(result.content[0].text), __isError: result.isError ?? false }
}

beforeEach(async () => {
  store = new RequestStore(100)
  const mcpServer = new McpServer({ name: 'test', version: '0.0.0' })
  registerTools(mcpServer, store, new SilentSender(), new SpanStore(50))

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await mcpServer.connect(serverTransport)
  client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(clientTransport)
  closeAll = async () => {
    await client.close()
    await mcpServer.close()
  }
})

describe('list_requests', () => {
  it('returns an empty page against an empty store rather than erroring', async () => {
    const payload = await call('list_requests')

    expect(payload.total).toBe(0)
    expect(payload.count).toBe(0)
    expect(payload.requests).toEqual([])
    await closeAll()
  })

  it('reports the store total alongside the page count', async () => {
    for (let i = 0; i < 5; i++) store.add(makeRequest())

    const payload = await call('list_requests', { limit: 2 })

    expect(payload.total).toBe(5)
    expect(payload.count).toBe(2)
    await closeAll()
  })

  it('pages without repeating or skipping a record', async () => {
    for (let i = 0; i < 5; i++) store.add(makeRequest())

    const first = await call('list_requests', { limit: 2, offset: 0 })
    const second = await call('list_requests', { limit: 2, offset: 2 })
    const ids = [
      ...(first.requests as NetworkRequest[]).map((r) => r.id),
      ...(second.requests as NetworkRequest[]).map((r) => r.id),
    ]

    expect(new Set(ids).size).toBe(4)
    await closeAll()
  })

  it('returns newest first', async () => {
    const oldest = makeRequest({ url: 'https://api.example.com/oldest' })
    store.add(oldest)
    const newest = makeRequest({ url: 'https://api.example.com/newest' })
    store.add(newest)

    const payload = await call('list_requests')

    expect((payload.requests as NetworkRequest[])[0].id).toBe(newest.id)
    await closeAll()
  })

  it('summary preserves page metadata and selection fields while omitting captured detail', async () => {
    store.add(makeRequest())
    const selected = makeRequest({
      runtime: 'server',
      requestBody: '{"name":"sample"}',
      responseBody: '{"ok":true}',
      responseHeaderValues: { 'content-type': ['application/json'] },
    })
    store.add(selected)
    store.add(makeRequest())

    const payload = await call('list_requests', { summary: true, limit: 1, offset: 1 })

    expect(payload).toMatchObject({ total: 3, offset: 1, count: 1, redaction: { applied: true } })
    expect(payload.requests).toEqual([
      {
        id: selected.id,
        url: selected.url,
        method: selected.method,
        status: selected.status,
        duration: selected.duration,
        runtime: 'server',
      },
    ])
    const full = await call('list_requests', { limit: 1, offset: 1 })
    expect((full.requests as NetworkRequest[])[0]).toMatchObject({
      requestBody: selected.requestBody,
      responseBody: selected.responseBody,
      requestHeaders: {},
      responseHeaders: {},
      responseHeaderValues: selected.responseHeaderValues,
    })
    await closeAll()
  })

  it('summary scrubs secret URLs by default and respects explicit unredacted selection', async () => {
    const secret = 'sk-live-summary-secret-123456789'
    const request = makeRequest({ url: `https://api.example.com/data?api_key=${secret}`, responseBody: secret })
    store.add(request)

    const payload = await call('list_requests', { summary: true })
    expect(JSON.stringify(payload)).not.toContain(secret)
    expect(payload.redaction).toMatchObject({ applied: true })
    expect((payload.redaction as { removed: string[] }).removed.length).toBeGreaterThan(0)

    const raw = await call('list_requests', { summary: true, unredacted: true })
    expect((raw.requests as NetworkRequest[])[0].url).toBe(request.url)
    expect((raw.requests as NetworkRequest[])[0]).not.toHaveProperty('responseBody')
    expect(raw.redaction).toEqual({ applied: false, removed: [] })
    await closeAll()
  })

  it('an offset past the end yields an empty page, not an error', async () => {
    store.add(makeRequest())

    const payload = await call('list_requests', { offset: 50 })

    expect(payload.count).toBe(0)
    expect(payload.__isError).toBe(false)
    await closeAll()
  })

  it('rejects a limit above the documented maximum instead of silently capping', async () => {
    const result = (await client.callTool({
      name: 'list_requests',
      arguments: { limit: 5000 },
    })) as { isError?: boolean }

    expect(result.isError).toBe(true)
    await closeAll()
  })
})

describe('get_request', () => {
  it('returns the record for a known id', async () => {
    const req = makeRequest({ url: 'https://api.example.com/target' })
    store.add(req)

    const payload = await call('get_request', { id: req.id })

    expect(payload.url).toBe('https://api.example.com/target')
    await closeAll()
  })

  it('reports not_found as an error result rather than throwing', async () => {
    const payload = await call('get_request', { id: 'nope' })

    expect(payload.error).toBe('not_found')
    expect(payload.__isError).toBe(true)
    await closeAll()
  })

  it('never leaks a redacted header value', async () => {
    const req = makeRequest({ requestHeaders: { authorization: 'Bearer sk-live-abc' } })
    store.add(req)

    const payload = await call('get_request', { id: req.id })

    expect(JSON.stringify(payload)).not.toContain('sk-live-abc')
    await closeAll()
  })
})

describe('search_requests', () => {
  beforeEach(() => {
    store.add(makeRequest({ url: 'https://api.example.com/users', method: 'GET', status: 200 }))
    store.add(makeRequest({ url: 'https://api.example.com/orders', method: 'POST', status: 500 }))
    store.add(makeRequest({ url: 'https://cdn.example.com/logo.png', method: 'GET', status: 404 }))
  })

  it('matches on a url substring', async () => {
    const payload = await call('search_requests', { urlContains: 'orders' })

    expect(payload.count).toBe(1)
    await closeAll()
  })

  it('filters by method', async () => {
    const payload = await call('search_requests', { method: 'POST' })

    expect(payload.count).toBe(1)
    await closeAll()
  })

  it('returns an empty result set for a query that matches nothing', async () => {
    const payload = await call('search_requests', { urlContains: 'nothing-matches-this' })

    expect(payload.count).toBe(0)
    expect(payload.__isError).toBe(false)
    await closeAll()
  })
})
