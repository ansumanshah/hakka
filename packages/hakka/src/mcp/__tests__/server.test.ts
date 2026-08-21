/**
 * Unit tests for hakka mcp:
 * - RequestStore: redaction, filters, stats, clear
 * - Tool handlers: all five read tools against a seeded store
 * - Write tools: create_mock/promote_capture_to_mock/delete_mock/clear_mocks/
 *   set_breakpoint/delete_breakpoint/set_throttle — assert the exact
 *   ControlCommand shape sent to a fake sender, and isError when disconnected.
 *   promote_capture_to_mock also covers: query-string-dropped pattern,
 *   Content-Encoding/Content-Length/Transfer-Encoding stripped from the
 *   replayed response, other headers (incl. comma-joined multi-value ones)
 *   surviving untouched, not_found/errored/incomplete refusals, and
 *   re-promotion replacing the same rule id instead of duplicating it
 * - generate_mocks: generation from seeded store, apply path asserts the
 *   exact mock.add ControlCommands sent, DSL narrowing, disconnected error
 * - generate_test: seeded store → generated hakka-core/test file content, DSL/
 *   method/urlContains narrowing, count matches, skip-no-status
 * - generate_repro: seeded store → full repro bundle (requests + mocks +
 *   generated hakka-core/test testFile), DSL narrowing, read-only (bridge untouched)
 * - get_trace: correlated request+span lookup by requestId/correlationId
 * - export_evidence: size-budgeted evidence bundle via buildEvidenceBundle, DSL narrowing
 * - replay_request / verify_fix: runtime-gate (§A: websocket_not_replayable /
 *   runtime_not_replayable), bridge-disconnected isError, await-marker timeout,
 *   happy path via a store.onAdd-driven FakeSender that echoes a replay back in
 * - SpanStore: append/getEntries/getByTraceId/clear/ring-buffer eviction
 * - RequestStore.onAdd: fires on add/update, unsubscribe works
 * - search_requests query DSL: scopes, regex/glob, negation, dur/size ranges
 * - BridgeListener parser: malformed frames, parseBridgeSpanFrame
 * - Smoke: InMemoryTransport tools/list listing all twenty tool names
 * - planServe: bridge-hosting decision (local vs remote, serve on/off)
 */

import { describe, it, expect, beforeEach } from 'bun:test'

import { REPLAY_MARKER_HEADER } from 'hakka-core'
import type { ControlCommand, FrameworkSpan, NetworkRequest } from 'hakka-core'

import { parseBridgeFrame, parseBridgeSpanFrame } from '../bridgeListener.js'
import { RequestStore } from '../RequestStore.js'
import { planServe } from '../server.js'
import { SpanStore } from '../SpanStore.js'
import type { ControlSender } from '../tools/index.js'

/** Fake ControlSender for tests — records every command instead of using a real WebSocket. */
class FakeSender implements ControlSender {
  sent: ControlCommand[] = []
  connected = true

  sendControl(cmd: ControlCommand): boolean {
    if (!this.connected) return false
    this.sent.push(cmd)
    return true
  }
}

let genIdSeq = 0
function makeGenRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  genIdSeq++
  return {
    id: `gen-req-${genIdSeq}`,
    url: 'https://api.example.com/users/1',
    method: 'GET',
    status: 200,
    startTime: genIdSeq,
    responseBody: '{"ok":true}',
    ...overrides,
  }
}

let idSeq = 0
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idSeq++
  return {
    id: `req-${idSeq}`,
    url: `https://api.example.com/resource/${idSeq}`,
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    duration: 100 + idSeq * 10,
    requestHeaders: {},
    responseHeaders: {},
    ...overrides,
  }
}

describe('RequestStore — basics', () => {
  let store: RequestStore

  beforeEach(() => {
    store = new RequestStore(10)
  })

  it('adds and retrieves a request', () => {
    const req = makeRequest()
    store.add(req)
    expect(store.get(req.id)).toBeDefined()
    expect(store.get(req.id)?.url).toBe(req.url)
  })

  it('reports size', () => {
    store.add(makeRequest())
    store.add(makeRequest())
    expect(store.size).toBe(2)
  })

  it('clear resets size', () => {
    store.add(makeRequest())
    store.clear()
    expect(store.size).toBe(0)
  })

  it('returns newest-first from getAll', () => {
    const r1 = makeRequest({ url: 'https://example.com/first' })
    const r2 = makeRequest({ url: 'https://example.com/second' })
    store.add(r1)
    store.add(r2)
    const all = store.getAll()
    expect(all[0]?.url).toBe(r2.url) // newest first
    expect(all[1]?.url).toBe(r1.url)
  })
})

describe('RequestStore — header redaction', () => {
  it('redacts authorization header at ingest', () => {
    const store = new RequestStore()
    const req = makeRequest({
      requestHeaders: { authorization: 'Bearer secret123', 'content-type': 'application/json' },
    })
    store.add(req)
    const stored = store.get(req.id)!
    expect(stored.requestHeaders?.authorization).toBe('[REDACTED]')
    expect(stored.requestHeaders?.['content-type']).toBe('application/json')
  })

  it('redacts cookie and set-cookie', () => {
    const store = new RequestStore()
    const req = makeRequest({
      requestHeaders: { cookie: 'session=abc' },
      responseHeaders: { 'set-cookie': 'session=xyz; HttpOnly' },
    })
    store.add(req)
    const stored = store.get(req.id)!
    expect(stored.requestHeaders?.cookie).toBe('[REDACTED]')
    expect(stored.responseHeaders?.['set-cookie']).toBe('[REDACTED]')
  })

  it('does not redact non-sensitive headers', () => {
    const store = new RequestStore()
    const req = makeRequest({
      requestHeaders: { accept: 'application/json', 'user-agent': 'test' },
    })
    store.add(req)
    const stored = store.get(req.id)!
    expect(stored.requestHeaders?.accept).toBe('application/json')
    expect(stored.requestHeaders?.['user-agent']).toBe('test')
  })
})

describe('RequestStore — filters', () => {
  let store: RequestStore

  beforeEach(() => {
    store = new RequestStore(20)
    store.add(makeRequest({ method: 'GET', url: 'https://api.example.com/users', status: 200 }))
    store.add(makeRequest({ method: 'POST', url: 'https://api.example.com/users', status: 201 }))
    store.add(makeRequest({ method: 'GET', url: 'https://api.example.com/items', status: 404, error: null }))
    store.add(
      makeRequest({ method: 'DELETE', url: 'https://api.example.com/items/1', status: 500, error: 'Server error' }),
    )
  })

  it('filters by method', () => {
    const results = store.getAll({ method: 'POST' })
    expect(results.length).toBe(1)
    expect(results[0]?.method).toBe('POST')
  })

  it('filters by method case-insensitive', () => {
    const results = store.getAll({ method: 'get' })
    expect(results.length).toBe(2)
  })

  it('filters by status (minimum)', () => {
    const results = store.getAll({ status: 400 })
    expect(results.length).toBe(2)
  })

  it('filters by urlContains', () => {
    const results = store.getAll({ urlContains: '/users' })
    expect(results.length).toBe(2)
  })

  it('filters errorOnly', () => {
    const results = store.getAll({ errorOnly: true })
    expect(results.every((r) => Boolean(r.error) || (r.status != null && r.status >= 400))).toBe(true)
    expect(results.length).toBeGreaterThan(0)
  })

  it('limits results', () => {
    const results = store.getAll({ limit: 2 })
    expect(results.length).toBe(2)
  })
})

describe('RequestStore — stats', () => {
  it('returns empty stats for empty store', () => {
    const store = new RequestStore()
    const s = store.stats()
    expect(s.total).toBe(0)
    expect(s.avgDurationMs).toBe(0)
    expect(s.errorRate).toBe(0)
  })

  it('computes error rate', () => {
    const store = new RequestStore()
    store.add(makeRequest({ status: 200, duration: 50 }))
    store.add(makeRequest({ status: 500, duration: 200, error: 'Internal error' }))
    const s = store.stats()
    expect(s.total).toBe(2)
    expect(s.error).toBe(1)
    expect(s.errorRate).toBeCloseTo(0.5)
  })

  it('tracks byHost', () => {
    const store = new RequestStore()
    store.add(makeRequest({ url: 'https://api.example.com/a' }))
    store.add(makeRequest({ url: 'https://api.example.com/b' }))
    store.add(makeRequest({ url: 'https://other.example.com/c' }))
    const s = store.stats()
    expect(s.byHost['api.example.com']).toBe(2)
    expect(s.byHost['other.example.com']).toBe(1)
  })

  it('identifies slowest request', () => {
    const store = new RequestStore()
    const fast = makeRequest({ duration: 50 })
    const slow = makeRequest({ duration: 9000 })
    store.add(fast)
    store.add(slow)
    const s = store.stats()
    expect(s.slowest?.id).toBe(slow.id)
  })
})

describe('RequestStore — onAdd', () => {
  it('fires the listener with the (redacted) request on add', () => {
    const store = new RequestStore()
    const seen: string[] = []
    store.onAdd((req) => seen.push(req.id))
    const req = makeRequest({ id: 'onadd-1' })
    store.add(req)
    expect(seen).toEqual(['onadd-1'])
  })

  it('fires again on an in-place update (same id added twice)', () => {
    const store = new RequestStore()
    const seen: string[] = []
    store.onAdd((req) => seen.push(req.id))
    const req = makeRequest({ id: 'onadd-2', status: undefined })
    store.add(req)
    store.add({ ...req, status: 200 })
    expect(seen).toEqual(['onadd-2', 'onadd-2'])
  })

  it('unsubscribe stops further notifications', () => {
    const store = new RequestStore()
    const seen: string[] = []
    const unsubscribe = store.onAdd((req) => seen.push(req.id))
    store.add(makeRequest({ id: 'before-unsub' }))
    unsubscribe()
    store.add(makeRequest({ id: 'after-unsub' }))
    expect(seen).toEqual(['before-unsub'])
  })

  it('supports multiple independent listeners', () => {
    const store = new RequestStore()
    const a: string[] = []
    const b: string[] = []
    store.onAdd((req) => a.push(req.id))
    store.onAdd((req) => b.push(req.id))
    store.add(makeRequest({ id: 'multi-1' }))
    expect(a).toEqual(['multi-1'])
    expect(b).toEqual(['multi-1'])
  })
})

describe('SpanStore', () => {
  function makeSpan(overrides: Partial<FrameworkSpan> = {}): FrameworkSpan {
    return {
      id: 'span-1',
      traceId: 'trace-1',
      parentId: null,
      name: 'render route',
      startTime: 0,
      endTime: 10,
      verbosity: 'primary',
      runtime: 'server',
      ...overrides,
    }
  }

  it('adds and returns spans oldest→newest', () => {
    const store = new SpanStore(10)
    store.add(makeSpan({ id: 's1' }))
    store.add(makeSpan({ id: 's2' }))
    expect(store.getEntries().map((s) => s.id)).toEqual(['s1', 's2'])
    expect(store.size).toBe(2)
  })

  it('filters by traceId via getByTraceId', () => {
    const store = new SpanStore(10)
    store.add(makeSpan({ id: 's1', traceId: 'trace-a' }))
    store.add(makeSpan({ id: 's2', traceId: 'trace-b' }))
    store.add(makeSpan({ id: 's3', traceId: 'trace-a' }))
    expect(store.getByTraceId('trace-a').map((s) => s.id)).toEqual(['s1', 's3'])
  })

  it('evicts oldest entries once capacity is reached', () => {
    const store = new SpanStore(2)
    store.add(makeSpan({ id: 's1' }))
    store.add(makeSpan({ id: 's2' }))
    store.add(makeSpan({ id: 's3' }))
    expect(store.getEntries().map((s) => s.id)).toEqual(['s2', 's3'])
    expect(store.size).toBe(2)
  })

  it('clear empties the store', () => {
    const store = new SpanStore(10)
    store.add(makeSpan())
    store.clear()
    expect(store.getEntries()).toEqual([])
    expect(store.size).toBe(0)
  })
})

describe('tool handlers (direct)', () => {
  let store: RequestStore

  beforeEach(() => {
    store = new RequestStore(20)
    for (let i = 0; i < 5; i++) {
      store.add(makeRequest({ method: i % 2 === 0 ? 'GET' : 'POST', status: i === 4 ? 500 : 200 }))
    }
  })

  function callListRequests(limit = 5, offset = 0) {
    const all = store.getAll({ limit: offset + limit })
    const page = all.slice(offset, offset + limit)
    return { total: store.size, offset, count: page.length, requests: page }
  }

  it('list_requests returns all with default limit', () => {
    const result = callListRequests()
    expect(result.total).toBe(5)
    expect(result.requests.length).toBe(5)
  })

  it('list_requests respects offset', () => {
    const all = callListRequests(5, 0)
    const paged = callListRequests(2, 2)
    expect(paged.requests[0]?.id).toBe(all.requests[2]?.id)
  })

  function callGetRequest(id: string) {
    const req = store.get(id)
    return req ?? null
  }

  it('get_request returns null for unknown id', () => {
    const result = callGetRequest('does-not-exist')
    expect(result).toBeNull()
  })
})

describe('bridge frame parser', () => {
  it('parses a valid bridge frame', () => {
    const req: NetworkRequest = makeRequest()
    const frame = JSON.stringify({ type: 'request', payload: req })
    const result = parseBridgeFrame(frame)
    expect(result?.id).toBe(req.id)
    expect(result?.url).toBe(req.url)
  })

  it('returns null for invalid JSON', () => {
    expect(parseBridgeFrame('{bad json')).toBeNull()
  })

  it('returns null for wrong type', () => {
    const frame = JSON.stringify({ type: 'ping', payload: {} })
    expect(parseBridgeFrame(frame)).toBeNull()
  })

  it('returns null for missing id', () => {
    const frame = JSON.stringify({ type: 'request', payload: { url: 'https://x.com' } })
    expect(parseBridgeFrame(frame)).toBeNull()
  })

  it('returns null for missing url', () => {
    const frame = JSON.stringify({ type: 'request', payload: { id: 'abc' } })
    expect(parseBridgeFrame(frame)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseBridgeFrame('')).toBeNull()
  })

  it('returns null for null payload', () => {
    const frame = JSON.stringify({ type: 'request', payload: null })
    expect(parseBridgeFrame(frame)).toBeNull()
  })
})

describe('parseBridgeSpanFrame', () => {
  const span: FrameworkSpan = {
    id: 'span-1',
    traceId: 'trace-1',
    parentId: null,
    name: 'render route',
    startTime: 0,
    endTime: 10,
    verbosity: 'primary',
    runtime: 'server',
  }

  it('parses a valid span frame', () => {
    const frame = JSON.stringify({ type: 'span', payload: span })
    const result = parseBridgeSpanFrame(frame)
    expect(result?.id).toBe('span-1')
    expect(result?.traceId).toBe('trace-1')
  })

  it('returns null for a request frame', () => {
    const frame = JSON.stringify({ type: 'request', payload: makeRequest() })
    expect(parseBridgeSpanFrame(frame)).toBeNull()
  })

  it('returns null for a control frame', () => {
    const frame = JSON.stringify({ type: 'control', payload: { kind: 'mock.clear' } })
    expect(parseBridgeSpanFrame(frame)).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseBridgeSpanFrame('{bad json')).toBeNull()
  })
})

describe('planServe', () => {
  it('hosts on the default local port', () => {
    expect(planServe('ws://localhost:8989', true)).toEqual({ host: 'localhost', port: 8989, shouldServe: true })
  })

  it('derives a custom local port from the url', () => {
    const plan = planServe('ws://localhost:9000', true)
    expect(plan.port).toBe(9000)
    expect(plan.shouldServe).toBe(true)
  })

  it('treats 127.0.0.1 as local (hostable)', () => {
    expect(planServe('ws://127.0.0.1:8989', true).shouldServe).toBe(true)
  })

  it('never hosts a remote bridge — connect as client only', () => {
    const plan = planServe('ws://bridge.example.com:8989', true)
    expect(plan.host).toBe('bridge.example.com')
    expect(plan.shouldServe).toBe(false)
  })

  it('does not host when serve is disabled', () => {
    expect(planServe('ws://localhost:8989', false).shouldServe).toBe(false)
  })

  it('falls back to local defaults on an unparseable url', () => {
    expect(planServe('not-a-url', true)).toEqual({ host: 'localhost', port: 8989, shouldServe: true })
  })
})

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer as McpServerCls } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerResources } from '../resources.js'
import { registerTools } from '../tools/index.js'

describe('MCP smoke test — tools/list via InMemoryTransport', () => {
  it('lists all twenty-one tool names', async () => {
    const s = new RequestStore(10)
    const sender = new FakeSender()
    const spanStore = new SpanStore(50)
    const mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, s, sender, spanStore)
    registerResources(mcpServer, s)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)

    const client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    const result = await client.listTools()
    const names = result.tools.map((t) => t.name)

    expect(names).toContain('list_requests')
    expect(names).toContain('get_request')
    expect(names).toContain('search_requests')
    expect(names).toContain('diagnose')
    expect(names).toContain('detect_leaks')
    expect(names).toContain('stats')
    expect(names).toContain('clear')
    expect(names).toContain('create_mock')
    expect(names).toContain('promote_capture_to_mock')
    expect(names).toContain('delete_mock')
    expect(names).toContain('clear_mocks')
    expect(names).toContain('set_breakpoint')
    expect(names).toContain('delete_breakpoint')
    expect(names).toContain('set_throttle')
    expect(names).toContain('generate_mocks')
    expect(names).toContain('generate_test')
    expect(names).toContain('generate_repro')
    expect(names).toContain('get_trace')
    expect(names).toContain('export_evidence')
    expect(names).toContain('replay_request')
    expect(names).toContain('verify_fix')
    expect(names.length).toBe(21)

    await client.close()
    await mcpServer.close()
  })
})

describe('write tools — MCP tools/call against a FakeSender', () => {
  let store: RequestStore
  let sender: FakeSender
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  beforeEach(async () => {
    store = new RequestStore(10)
    sender = new FakeSender()
    const spanStore = new SpanStore(50)
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
  })

  it('diagnose returns ranked findings + summary over captured requests', async () => {
    store.add(
      makeRequest({
        id: 'f1',
        method: 'POST',
        url: 'https://api.example.com/pay',
        status: 500,
        responseBody: '{"error":"boom"}',
      }),
    )
    store.add(makeRequest({ id: 'ok', method: 'GET', url: 'https://api.example.com/users', status: 200 }))

    const result = await client.callTool({ name: 'diagnose', arguments: {} })
    expect(result.isError).toBeFalsy()
    const d = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(d.total).toBe(2)
    expect(d.failed).toBe(1)
    expect(
      d.findings.some((f: { kind: string; requestId?: string }) => f.kind === 'failure' && f.requestId === 'f1'),
    ).toBe(true)
    expect(d.summary).toContain('1 failed')
    await closeAll()
  })

  it('create_mock (mode=mock) sends a mock.add command with the exact rule shape', async () => {
    const result = await client.callTool({
      name: 'create_mock',
      arguments: { pattern: '/api/users', method: 'GET', mode: 'mock', status: 201, body: '{"ok":true}' },
    })
    expect(result.isError).toBeFalsy()
    const text = (result.content as { text: string }[])[0]!.text
    const parsed = JSON.parse(text)
    expect(parsed.id).toBe('mcp-mock-1')
    expect(parsed.sent).toBe(true)

    expect(sender.sent.length).toBe(1)
    expect(sender.sent[0]).toEqual({
      kind: 'mock.add',
      rule: {
        id: 'mcp-mock-1',
        pattern: '/api/users',
        method: 'GET',
        mode: 'mock',
        response: { status: 201, body: '{"ok":true}', delay: undefined },
        enabled: true,
      },
    })
    await closeAll()
  })

  it('create_mock with a modify block becomes a rewrite rule carrying the edits', async () => {
    const modify = {
      setRequestHeaders: { 'x-debug': '1' },
      removeResponseHeaders: ['set-cookie'],
      status: 503,
      replaceBody: [{ find: 'live', replace: 'stubbed' }],
    }
    const result = await client.callTool({
      name: 'create_mock',
      arguments: { pattern: '/api/edit', mode: 'mock', modify },
    })
    expect(result.isError).toBeFalsy()
    expect(sender.sent[0]).toEqual({
      kind: 'mock.add',
      rule: {
        id: 'mcp-mock-1',
        pattern: '/api/edit',
        method: undefined,
        mode: 'rewrite',
        modify,
        response: { status: 200, body: '', delay: undefined },
        enabled: true,
      },
    })
    await closeAll()
  })

  it('create_mock (mode=redirect) carries modify alongside redirectTo', async () => {
    const result = await client.callTool({
      name: 'create_mock',
      arguments: {
        pattern: '/api/old',
        mode: 'redirect',
        redirectTo: 'https://staging.example.com/new',
        modify: { setQueryParams: { debug: '1' } },
      },
    })
    expect(result.isError).toBeFalsy()
    const rule = (sender.sent[0] as { rule: Record<string, unknown> }).rule
    expect(rule.mode).toBe('rewrite')
    expect(rule.redirectTo).toBe('https://staging.example.com/new')
    expect(rule.modify).toEqual({ setQueryParams: { debug: '1' } })
    await closeAll()
  })

  it('create_mock (mode=block) sends a mock.add command with block:true', async () => {
    const result = await client.callTool({
      name: 'create_mock',
      arguments: { pattern: '/api/blocked', mode: 'block' },
    })
    expect(result.isError).toBeFalsy()
    expect(sender.sent[0]).toEqual({
      kind: 'mock.add',
      rule: {
        id: 'mcp-mock-1',
        pattern: '/api/blocked',
        method: undefined,
        block: true,
        response: { status: 0, body: '', delay: undefined },
        enabled: true,
      },
    })
    await closeAll()
  })

  it('create_mock (mode=redirect) sends a mock.add command with redirectTo', async () => {
    const result = await client.callTool({
      name: 'create_mock',
      arguments: { pattern: '/api/old', mode: 'redirect', redirectTo: 'https://api.example.com/new' },
    })
    expect(result.isError).toBeFalsy()
    expect(sender.sent[0]).toEqual({
      kind: 'mock.add',
      rule: {
        id: 'mcp-mock-1',
        pattern: '/api/old',
        method: undefined,
        mode: 'rewrite',
        redirectTo: 'https://api.example.com/new',
        response: { status: 200, body: '', delay: undefined },
        enabled: true,
      },
    })
    await closeAll()
  })

  it('create_mock (mode=redirect) without redirectTo is an isError, never sent', async () => {
    const result = await client.callTool({
      name: 'create_mock',
      arguments: { pattern: '/api/old', mode: 'redirect' },
    })
    expect(result.isError).toBe(true)
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('create_mock mints sequential ids across calls', async () => {
    await client.callTool({ name: 'create_mock', arguments: { pattern: '/a' } })
    const result2 = await client.callTool({ name: 'create_mock', arguments: { pattern: '/b' } })
    const text = (result2.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).id).toBe('mcp-mock-2')
    await closeAll()
  })

  it('create_mock is isError when the bridge is disconnected', async () => {
    sender.connected = false
    const result = await client.callTool({ name: 'create_mock', arguments: { pattern: '/api/x' } })
    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).sent).toBe(false)
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('promote_capture_to_mock freezes a captured response and installs it as a mock rule', async () => {
    store.add(
      makeRequest({
        id: 'cap-1',
        method: 'GET',
        url: 'https://api.example.com/v1/users/42?debug=1&token=abc',
        status: 201,
        responseHeaders: { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '9' },
        responseBody: '{"ok":true}',
      }),
    )

    const result = await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'cap-1' } })
    expect(result.isError).toBeFalsy()
    const text = (result.content as { text: string }[])[0]!.text
    const parsed = JSON.parse(text)
    expect(parsed.sent).toBe(true)
    expect(parsed.pattern).toBe('https://api.example.com/v1/users/42')
    expect(typeof parsed.id).toBe('string')

    expect(sender.sent.length).toBe(1)
    const sent = sender.sent[0] as { kind: string; rule: Record<string, unknown> }
    expect(sent.kind).toBe('mock.add')
    expect(sent.rule.pattern).toBe('https://api.example.com/v1/users/42')
    expect(sent.rule.method).toBe('GET')
    // query string dropped from the match pattern — target the endpoint, not this one query string
    expect(sent.rule.pattern).not.toContain('debug')
    expect(sent.rule.pattern).not.toContain('token')
    expect(sent.rule.response).toEqual({
      status: 201,
      headers: { 'content-type': 'application/json' },
      body: '{"ok":true}',
      delay: 0,
    })
    await closeAll()
  })

  it('promote_capture_to_mock drops Content-Encoding/Content-Length/Transfer-Encoding but keeps other headers', async () => {
    store.add(
      makeRequest({
        id: 'cap-headers',
        url: 'https://api.example.com/thing',
        status: 200,
        responseHeaders: {
          'content-type': 'text/plain',
          'content-encoding': 'br',
          'content-length': '123',
          'transfer-encoding': 'chunked',
          vary: 'Accept, Accept-Encoding',
        },
        responseBody: 'hello',
      }),
    )

    await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'cap-headers' } })
    const rule = (sender.sent[0] as { rule: { response: { headers: Record<string, string> } } }).rule
    expect(rule.response.headers).toEqual({
      'content-type': 'text/plain',
      // comma-joined multi-value header (already merged at capture time) survives untouched
      vary: 'Accept, Accept-Encoding',
    })
    await closeAll()
  })

  it('promote_capture_to_mock is not_found for an unknown id', async () => {
    const result = await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'does-not-exist' } })
    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).error).toBe('not_found')
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('promote_capture_to_mock refuses an errored capture instead of fabricating a 200 mock', async () => {
    store.add(
      makeRequest({ id: 'cap-err', url: 'https://api.example.com/broken', status: undefined, error: 'timeout' }),
    )

    const result = await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'cap-err' } })
    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).error).toBe('errored_capture')
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('promote_capture_to_mock refuses an incomplete (still pending) capture', async () => {
    store.add(makeRequest({ id: 'cap-pending', url: 'https://api.example.com/slow', status: undefined }))

    const result = await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'cap-pending' } })
    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).error).toBe('incomplete_capture')
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('promote_capture_to_mock is isError when the bridge is disconnected', async () => {
    store.add(makeRequest({ id: 'cap-disc', url: 'https://api.example.com/thing', status: 200 }))
    sender.connected = false

    const result = await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'cap-disc' } })
    expect(result.isError).toBe(true)
    const text = (result.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).sent).toBe(false)
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('re-promoting the same capture id yields the same mock rule id (replace, not duplicate)', async () => {
    store.add(makeRequest({ id: 'cap-dup', url: 'https://api.example.com/thing', status: 200, responseBody: 'a' }))

    const first = await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'cap-dup' } })
    const firstId = JSON.parse((first.content as { text: string }[])[0]!.text).id

    // a second, different capture at the exact same endpoint (method + pattern)
    store.add(
      makeRequest({ id: 'cap-dup-2', url: 'https://api.example.com/thing?x=2', status: 200, responseBody: 'b' }),
    )
    const second = await client.callTool({ name: 'promote_capture_to_mock', arguments: { id: 'cap-dup-2' } })
    const secondId = JSON.parse((second.content as { text: string }[])[0]!.text).id

    expect(secondId).toBe(firstId)
    expect(sender.sent.length).toBe(2)
    expect((sender.sent[0] as { rule: { id: string } }).rule.id).toBe(
      (sender.sent[1] as { rule: { id: string } }).rule.id,
    )
    await closeAll()
  })

  it('delete_mock sends an exact mock.remove command', async () => {
    const result = await client.callTool({ name: 'delete_mock', arguments: { id: 'mcp-mock-3' } })
    expect(result.isError).toBeFalsy()
    expect(sender.sent).toEqual([{ kind: 'mock.remove', id: 'mcp-mock-3' }])
    await closeAll()
  })

  it('delete_mock is isError when disconnected', async () => {
    sender.connected = false
    const result = await client.callTool({ name: 'delete_mock', arguments: { id: 'mcp-mock-3' } })
    expect(result.isError).toBe(true)
    await closeAll()
  })

  it('clear_mocks sends an exact mock.clear command', async () => {
    const result = await client.callTool({ name: 'clear_mocks', arguments: {} })
    expect(result.isError).toBeFalsy()
    expect(sender.sent).toEqual([{ kind: 'mock.clear' }])
    await closeAll()
  })

  it('clear_mocks is isError when disconnected', async () => {
    sender.connected = false
    const result = await client.callTool({ name: 'clear_mocks', arguments: {} })
    expect(result.isError).toBe(true)
    await closeAll()
  })

  it('set_breakpoint sends an exact breakpoint.add command and mints an id', async () => {
    const result = await client.callTool({
      name: 'set_breakpoint',
      arguments: { pattern: '/api/checkout', on: 'response' },
    })
    expect(result.isError).toBeFalsy()
    const text = (result.content as { text: string }[])[0]!.text
    expect(JSON.parse(text).id).toBe('mcp-bp-1')
    expect(sender.sent).toEqual([
      {
        kind: 'breakpoint.add',
        breakpoint: { id: 'mcp-bp-1', pattern: '/api/checkout', on: 'response', enabled: true },
      },
    ])
    await closeAll()
  })

  it('set_breakpoint is isError when disconnected', async () => {
    sender.connected = false
    const result = await client.callTool({
      name: 'set_breakpoint',
      arguments: { pattern: '/api/checkout', on: 'request' },
    })
    expect(result.isError).toBe(true)
    await closeAll()
  })

  it('delete_breakpoint sends an exact breakpoint.remove command', async () => {
    const result = await client.callTool({ name: 'delete_breakpoint', arguments: { id: 'mcp-bp-7' } })
    expect(result.isError).toBeFalsy()
    expect(sender.sent).toEqual([{ kind: 'breakpoint.remove', id: 'mcp-bp-7' }])
    await closeAll()
  })

  it('delete_breakpoint is isError when disconnected', async () => {
    sender.connected = false
    const result = await client.callTool({ name: 'delete_breakpoint', arguments: { id: 'mcp-bp-7' } })
    expect(result.isError).toBe(true)
    await closeAll()
  })

  it('set_throttle sends an exact throttle.set command for a preset profile', async () => {
    const result = await client.callTool({ name: 'set_throttle', arguments: { profile: 'slow-3g' } })
    expect(result.isError).toBeFalsy()
    expect(sender.sent).toEqual([
      { kind: 'throttle.set', profile: 'slow-3g', latencyMs: undefined, downloadKbps: undefined },
    ])
    await closeAll()
  })

  it('set_throttle sends an exact throttle.set command for custom latency/bandwidth', async () => {
    const result = await client.callTool({
      name: 'set_throttle',
      arguments: { profile: 'custom', latencyMs: 300, downloadKbps: 512 },
    })
    expect(result.isError).toBeFalsy()
    expect(sender.sent).toEqual([{ kind: 'throttle.set', profile: 'custom', latencyMs: 300, downloadKbps: 512 }])
    await closeAll()
  })

  it('set_throttle is isError when disconnected', async () => {
    sender.connected = false
    const result = await client.callTool({ name: 'set_throttle', arguments: { profile: 'offline' } })
    expect(result.isError).toBe(true)
    await closeAll()
  })
})

describe('search_requests — advanced query DSL', () => {
  let store: RequestStore
  let mcpServer: McpServerCls
  let client: Client

  beforeEach(async () => {
    store = new RequestStore(50)
    store.add(
      makeRequest({
        url: 'https://api.example.com/users/42',
        method: 'GET',
        status: 200,
        duration: 50,
        requestHeaders: { 'x-trace': 'abc' },
        responseBody: '{"name":"ok"}',
      }),
    )
    store.add(
      makeRequest({
        url: 'https://api.example.com/orders/1',
        method: 'POST',
        status: 500,
        duration: 900,
        requestBody: '{"password":"hunter2"}',
      }),
    )
    store.add(
      makeRequest({
        url: 'https://cdn.example.com/assets/logo.png',
        method: 'GET',
        status: 200,
        duration: 20,
      }),
    )

    const sender = new FakeSender()
    const spanStore = new SpanStore(50)
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)
  })

  async function search(args: Record<string, unknown>) {
    const result = await client.callTool({ name: 'search_requests', arguments: args })
    const text = (result.content as { text: string }[])[0]!.text
    return JSON.parse(text) as { count: number; requests: NetworkRequest[] }
  }

  it('url: scope narrows to matching URLs', async () => {
    const { requests } = await search({ query: 'url:/users' })
    expect(requests.length).toBe(1)
    expect(requests[0]?.url).toContain('/users/42')
  })

  it('body: scope matches request/response body text', async () => {
    const { requests } = await search({ query: 'body:hunter2' })
    expect(requests.length).toBe(1)
    expect(requests[0]?.url).toContain('/orders/1')
  })

  it('/regex/ mode matches', async () => {
    const { requests } = await search({ query: '/orders\\/\\d+/' })
    expect(requests.length).toBe(1)
    expect(requests[0]?.url).toContain('/orders/1')
  })

  it('*glob* mode matches', async () => {
    const { requests } = await search({ query: '*assets*logo*' })
    expect(requests.length).toBe(1)
    expect(requests[0]?.url).toContain('logo.png')
  })

  it('-negation excludes matches', async () => {
    const { requests } = await search({ query: '-cdn' })
    expect(requests.every((r) => !r.url.includes('cdn'))).toBe(true)
    expect(requests.length).toBe(2)
  })

  it('dur> range filters by duration', async () => {
    const { requests } = await search({ query: 'dur>100' })
    expect(requests.length).toBe(1)
    expect(requests[0]?.url).toContain('/orders/1')
  })

  it('query narrows BEFORE structured filters (ANDed)', async () => {
    const { requests } = await search({ query: 'url:api', status: 400 })
    expect(requests.length).toBe(1)
    expect(requests[0]?.status).toBe(500)
  })

  it('empty/absent query returns all (subject to other filters)', async () => {
    const { requests } = await search({})
    expect(requests.length).toBe(3)
  })
})

describe('generate_mocks', () => {
  let store: RequestStore
  let sender: FakeSender
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  beforeEach(async () => {
    store = new RequestStore(50)
    sender = new FakeSender()
    const spanStore = new SpanStore(50)
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
  })

  async function generateMocks(args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name: 'generate_mocks', arguments: args })
    const text = (result.content as { text: string }[])[0]!.text
    return { isError: result.isError, ...(JSON.parse(text) as { applied: number; rules: unknown[] }) }
  }

  it('generates rules from a seeded store, deduped newest-wins, with apply=false by default', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/users/1',
        method: 'GET',
        startTime: 1,
        status: 200,
        responseBody: '{"name":"old"}',
      }),
    )
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/users/1',
        method: 'GET',
        startTime: 2,
        status: 200,
        responseBody: '{"name":"new"}',
      }),
    )
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/orders/9',
        method: 'POST',
        status: 201,
        responseBody: '{"id":9}',
      }),
    )

    const { applied, rules } = await generateMocks()
    expect(applied).toBe(0)
    expect(rules.length).toBe(2)
    expect(sender.sent.length).toBe(0) // apply=false never sends

    const userRule = (rules as { pattern: string; response: { body: string } }[]).find((r) => r.pattern === '/users/1')
    expect(userRule?.response.body).toBe('{"name":"new"}') // newest wins
    await closeAll()
  })

  it('mints ids with the mcp-gen prefix', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/a' }))
    store.add(makeGenRequest({ url: 'https://api.example.com/b' }))
    const { rules } = await generateMocks()
    const ids = (rules as { id: string }[]).map((r) => r.id).sort()
    expect(ids).toEqual(['mcp-gen-1', 'mcp-gen-2'])
    await closeAll()
  })

  it('apply=true sends the exact mock.add ControlCommands and reports the count', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/users/1',
        method: 'GET',
        status: 200,
        responseHeaders: { 'Content-Type': 'application/json' },
        responseBody: '{"ok":true}',
      }),
    )
    store.add(
      makeGenRequest({ url: 'https://api.example.com/orders/9', method: 'POST', status: 201, responseBody: '{}' }),
    )

    const { applied, rules, isError } = await generateMocks({ apply: true })
    expect(isError).toBeFalsy()
    expect(applied).toBe(2)
    expect(rules.length).toBe(2)

    expect(sender.sent.length).toBe(2)
    for (const cmd of sender.sent) {
      expect(cmd.kind).toBe('mock.add')
    }
    // dispatch() round-trips every command through parseControlCommand, which
    // fills the optional MockRuleInput fields (block/redirectTo/response.delay)
    // in explicitly as `undefined` — so compare the sent rule's *content*
    // against the returned rule rather than requiring byte-identical objects.
    const userGenerated = (rules as { id: string; pattern: string }[]).find((r) => r.pattern === '/users/1')!
    const userCmd = sender.sent.find(
      (c) => c.kind === 'mock.add' && (c as { rule: { pattern: string } }).rule.pattern === '/users/1',
    )
    expect(userCmd).toEqual({
      kind: 'mock.add',
      rule: {
        id: userGenerated.id,
        pattern: '/users/1',
        method: 'GET',
        mode: 'mock',
        block: undefined,
        redirectTo: undefined,
        response: {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: '{"ok":true}',
          delay: undefined,
        },
        enabled: true,
      },
    })
    await closeAll()
  })

  it('query DSL narrows which requests generate rules', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/users/1',
        method: 'GET',
        status: 200,
        responseBody: '{"password":"hunter2"}',
      }),
    )
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/orders/9',
        method: 'POST',
        status: 201,
        responseBody: '{"id":9}',
      }),
    )

    const { rules } = await generateMocks({ query: 'body:hunter2' })
    expect(rules.length).toBe(1)
    expect((rules as { pattern: string }[])[0]?.pattern).toBe('/users/1')
    await closeAll()
  })

  it('method and urlContains narrow which requests generate rules', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', method: 'GET', status: 200 }))
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', method: 'DELETE', status: 204 }))
    store.add(makeGenRequest({ url: 'https://api.example.com/orders/9', method: 'GET', status: 200 }))

    const { rules } = await generateMocks({ method: 'GET', urlContains: '/users' })
    expect(rules.length).toBe(1)
    expect((rules as { method?: string; pattern: string }[])[0]).toMatchObject({
      method: 'GET',
      pattern: '/users/1',
    })
    await closeAll()
  })

  it('skips pending requests with no status and no response body', async () => {
    store.add(makeGenRequest({ status: undefined, responseBody: undefined }))
    const { rules } = await generateMocks()
    expect(rules.length).toBe(0)
    await closeAll()
  })

  it('apply=true is isError when the bridge is disconnected, and sends nothing', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1' }))
    sender.connected = false

    const { isError, applied, rules } = await generateMocks({ apply: true })
    expect(isError).toBe(true)
    expect(applied).toBe(0)
    expect(rules.length).toBe(1) // rules are still generated/returned for visibility
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('apply=false never touches the bridge even when disconnected', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1' }))
    sender.connected = false

    const { isError, applied, rules } = await generateMocks({ apply: false })
    expect(isError).toBeFalsy()
    expect(applied).toBe(0)
    expect(rules.length).toBe(1)
    await closeAll()
  })
})

describe('generate_test', () => {
  let store: RequestStore
  let sender: FakeSender
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  beforeEach(async () => {
    store = new RequestStore(50)
    sender = new FakeSender()
    const spanStore = new SpanStore(50)
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
  })

  async function generateTest(args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name: 'generate_test', arguments: args })
    const text = (result.content as { text: string }[])[0]!.text
    return { isError: result.isError, ...(JSON.parse(text) as { count: number; code: string }) }
  }

  it('generates a test file from a seeded store, count matches selected requests', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/users/1',
        method: 'GET',
        status: 200,
        responseBody: '{"id":1,"name":"Ada"}',
      }),
    )
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/orders/9',
        method: 'POST',
        status: 201,
        responseBody: '{"id":9}',
      }),
    )

    const { isError, count, code } = await generateTest()
    expect(isError).toBeFalsy()
    expect(count).toBe(2)
    expect(code).toContain('describe("Hakka captured session"')
    expect(code).toContain('describe("api.example.com"')
    expect(code).toContain('it("GET /users/1 → 200"')
    expect(code).toContain('it("POST /orders/9 → 201"')
    await closeAll()
  })

  it('never touches the bridge (read-only tool)', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1' }))
    await generateTest()
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('DSL query narrows which requests are included, count reflects it', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/users/1',
        status: 200,
        responseBody: '{"password":"hunter2"}',
      }),
    )
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/orders/9',
        method: 'POST',
        status: 201,
        responseBody: '{"id":9}',
      }),
    )

    const { count, code } = await generateTest({ query: 'body:hunter2' })
    expect(count).toBe(1)
    expect(code).toContain('/users/1')
    expect(code).not.toContain('/orders/9')
  })

  it('method and urlContains narrow the selection', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', method: 'GET', status: 200 }))
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', method: 'DELETE', status: 204 }))
    store.add(makeGenRequest({ url: 'https://api.example.com/orders/9', method: 'GET', status: 200 }))

    const { count, code } = await generateTest({ method: 'GET', urlContains: '/users' })
    expect(count).toBe(1)
    expect(code).toContain('GET /users/1')
    expect(code).not.toContain('/orders/9')
  })

  it('honors suiteName and framework options', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1' }))
    const { code } = await generateTest({ suiteName: 'Checkout regression', framework: 'bun' })
    expect(code).toContain('describe("Checkout regression"')
    expect(code).toContain("from 'bun:test'")
  })

  it('requests with no status are skipped with a comment, still counted in `count`', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/pending', status: undefined }))
    const { count, code } = await generateTest()
    expect(count).toBe(1) // count reflects the selected pool, not the emitted it() blocks
    expect(code).toContain('// skipped:')
    expect(code).not.toContain('it("GET')
  })

  it('respects limit (most recent first)', async () => {
    for (let i = 0; i < 5; i++) {
      store.add(makeGenRequest({ url: `https://api.example.com/item/${i}` }))
    }
    const { count } = await generateTest({ limit: 2 })
    expect(count).toBe(2)
  })

  it('empty store still returns a valid (empty) suite', async () => {
    const { count, code } = await generateTest()
    expect(count).toBe(0)
    expect(code).toContain('No requests were captured')
  })
})

describe('generate_repro', () => {
  let store: RequestStore
  let sender: FakeSender
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  beforeEach(async () => {
    store = new RequestStore(50)
    sender = new FakeSender()
    const spanStore = new SpanStore(50)
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
  })

  interface ReproBundleResult {
    version: number
    exportedAt?: string
    meta?: Record<string, unknown>
    requests: NetworkRequest[]
    mocks: { id: string; pattern: string; response: { body: string; status: number } }[]
    testFile: string
  }

  async function generateRepro(args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name: 'generate_repro', arguments: args })
    const text = (result.content as { text: string }[])[0]!.text
    return { isError: result.isError, ...(JSON.parse(text) as ReproBundleResult) }
  }

  it('returns a bundle with requests, mocks, and a testFile from a seeded store', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/checkout',
        method: 'POST',
        status: 500,
        responseBody: '{"error":"boom"}',
      }),
    )

    const { isError, requests, mocks, testFile } = await generateRepro()
    expect(isError).toBeFalsy()
    expect(requests.length).toBe(1)
    expect(mocks.length).toBe(1)
    expect(mocks[0]?.pattern).toBe('/checkout')
    expect(mocks[0]?.response.status).toBe(500)
    expect(typeof testFile).toBe('string')
    expect(testFile).toContain('describe(')
    expect(testFile).toContain('POST /checkout')
    await closeAll()
  })

  it('mints mock rule ids with the mcp-repro prefix', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/a' }))
    store.add(makeGenRequest({ url: 'https://api.example.com/b' }))
    const { mocks } = await generateRepro()
    const ids = mocks.map((m) => m.id).sort()
    expect(ids).toEqual(['mcp-repro-1', 'mcp-repro-2'])
    await closeAll()
  })

  it('stamps version and exportedAt', async () => {
    store.add(makeGenRequest())
    const { version, exportedAt } = await generateRepro()
    expect(version).toBe(1)
    expect(typeof exportedAt).toBe('string')
    await closeAll()
  })

  it('attaches meta when provided', async () => {
    store.add(makeGenRequest())
    const { meta } = await generateRepro({ meta: { failure: 'checkout 500s under load' } })
    expect(meta).toEqual({ failure: 'checkout 500s under load' })
    await closeAll()
  })

  it('query DSL narrows which requests are included in both requests and mocks', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/users/1',
        status: 200,
        responseBody: '{"password":"hunter2"}',
      }),
    )
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/orders/9',
        method: 'POST',
        status: 201,
        responseBody: '{"id":9}',
      }),
    )

    const { requests, mocks, testFile } = await generateRepro({ query: 'body:hunter2' })
    expect(requests.length).toBe(1)
    expect(mocks.length).toBe(1)
    expect(mocks[0]?.pattern).toBe('/users/1')
    expect(testFile).toContain('/users/1')
    expect(testFile).not.toContain('/orders/9')
    await closeAll()
  })

  it('method and urlContains narrow the selection', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', method: 'GET', status: 200 }))
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', method: 'DELETE', status: 204 }))
    store.add(makeGenRequest({ url: 'https://api.example.com/orders/9', method: 'GET', status: 200 }))

    const { requests, mocks } = await generateRepro({ method: 'GET', urlContains: '/users' })
    expect(requests.length).toBe(1)
    expect(mocks.length).toBe(1)
    expect(mocks[0]?.pattern).toBe('/users/1')
    await closeAll()
  })

  it('honors suiteName and framework for the generated testFile', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1' }))
    const { testFile } = await generateRepro({ suiteName: 'Checkout regression', framework: 'bun' })
    expect(testFile).toContain('describe("Checkout regression"')
    expect(testFile).toContain("from 'bun:test'")
    await closeAll()
  })

  it('never touches the bridge (read-only tool)', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1' }))
    await generateRepro()
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('is read-only even when the bridge is disconnected', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1' }))
    sender.connected = false
    const { isError, requests, mocks } = await generateRepro()
    expect(isError).toBeFalsy()
    expect(requests.length).toBe(1)
    expect(mocks.length).toBe(1)
    await closeAll()
  })

  it('skips pending requests (no status, no body) when generating mocks, but keeps them in requests', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/pending', status: undefined, responseBody: undefined }))
    const { requests, mocks, testFile } = await generateRepro()
    expect(requests.length).toBe(1)
    expect(mocks.length).toBe(0)
    expect(testFile).toContain('// skipped:')
    await closeAll()
  })

  it('respects limit (most recent first)', async () => {
    for (let i = 0; i < 5; i++) {
      store.add(makeGenRequest({ url: `https://api.example.com/item/${i}` }))
    }
    const { requests } = await generateRepro({ limit: 2 })
    expect(requests.length).toBe(2)
    await closeAll()
  })

  it('empty store still returns a valid empty bundle', async () => {
    const { requests, mocks, testFile } = await generateRepro()
    expect(requests).toEqual([])
    expect(mocks).toEqual([])
    expect(testFile).toContain('No requests were captured')
    await closeAll()
  })
})

describe('get_trace', () => {
  let store: RequestStore
  let spanStore: SpanStore
  let sender: FakeSender
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  beforeEach(async () => {
    store = new RequestStore(50)
    spanStore = new SpanStore(50)
    sender = new FakeSender()
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
  })

  async function getTrace(args: Record<string, unknown>) {
    const result = await client.callTool({ name: 'get_trace', arguments: args })
    const text = (result.content as { text: string }[])[0]!.text
    return { isError: result.isError, ...(JSON.parse(text) as Record<string, unknown>) }
  }

  it('resolves the trace group from a requestId and includes correlated spans', async () => {
    store.add(makeRequest({ id: 'hop-1', correlationId: 'trace-x', startTime: 0, url: 'https://api.example.com/a' }))
    store.add(makeRequest({ id: 'hop-2', correlationId: 'trace-x', startTime: 5, url: 'https://api.example.com/b' }))
    store.add(makeRequest({ id: 'other', correlationId: 'trace-y', startTime: 0, url: 'https://api.example.com/c' }))
    spanStore.add({
      id: 'span-1',
      traceId: 'trace-x',
      parentId: null,
      name: 'render route',
      startTime: 0,
      endTime: 10,
      verbosity: 'primary',
      runtime: 'server',
    })

    const { isError, requests, trace, traceSummary } = (await getTrace({ requestId: 'hop-1' })) as {
      isError?: boolean
      requests: NetworkRequest[]
      trace: { bars: unknown[] }
      traceSummary: unknown
    }
    expect(isError).toBeFalsy()
    expect(requests.map((r) => r.id).sort()).toEqual(['hop-1', 'hop-2'])
    expect(trace.bars.length).toBeGreaterThan(0)
    expect(traceSummary).not.toBeNull()
    await closeAll()
  })

  it('accepts a correlationId directly, without a seed request lookup', async () => {
    store.add(makeRequest({ id: 'hop-1', correlationId: 'trace-z' }))
    const { isError, requests } = (await getTrace({ correlationId: 'trace-z' })) as {
      isError?: boolean
      requests: NetworkRequest[]
    }
    expect(isError).toBeFalsy()
    expect(requests.length).toBe(1)
    await closeAll()
  })

  it('is isError when neither requestId nor correlationId is given', async () => {
    const { isError } = await getTrace({})
    expect(isError).toBe(true)
    await closeAll()
  })

  it('is isError with not_found for an unknown requestId', async () => {
    const { isError, error } = (await getTrace({ requestId: 'does-not-exist' })) as {
      isError?: boolean
      error?: string
    }
    expect(isError).toBe(true)
    expect(error).toBe('not_found')
    await closeAll()
  })

  it('never touches the bridge (read-only tool)', async () => {
    store.add(makeRequest({ id: 'hop-1', correlationId: 'trace-x' }))
    await getTrace({ requestId: 'hop-1' })
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })
})

describe('export_evidence', () => {
  let store: RequestStore
  let spanStore: SpanStore
  let sender: FakeSender
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  beforeEach(async () => {
    store = new RequestStore(50)
    spanStore = new SpanStore(50)
    sender = new FakeSender()
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
  })

  async function exportEvidence(args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name: 'export_evidence', arguments: args })
    const text = (result.content as { text: string }[])[0]!.text
    return { isError: result.isError, ...(JSON.parse(text) as Record<string, unknown>) }
  }

  it('builds a bundle from the seeded store with console always empty (MCP has no log source)', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', status: 200 }))
    const bundle = (await exportEvidence()) as {
      isError?: boolean
      requests: unknown[]
      console: unknown[]
      version: number
    }
    expect(bundle.isError).toBeFalsy()
    expect(bundle.requests.length).toBe(1)
    expect(bundle.console).toEqual([])
    expect(bundle.version).toBe(1)
    await closeAll()
  })

  it('DSL query narrows the pool feeding the bundle', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/users/1', responseBody: '{"password":"hunter2"}' }))
    store.add(makeGenRequest({ url: 'https://api.example.com/orders/9', responseBody: '{"id":9}' }))
    const bundle = (await exportEvidence({ query: 'body:hunter2' })) as { requests: { url: string }[] }
    expect(bundle.requests.length).toBe(1)
    expect(bundle.requests[0]?.url).toContain('/users/1')
    await closeAll()
  })

  it('is isError with no_requests when the filtered pool is empty', async () => {
    const { isError, error } = (await exportEvidence({ urlContains: '/does-not-exist' })) as {
      isError?: boolean
      error?: string
    }
    expect(isError).toBe(true)
    expect(error).toBe('no_requests')
    await closeAll()
  })

  it('a small maxBytes triggers explicit truncations, never silently', async () => {
    store.add(
      makeGenRequest({
        url: 'https://api.example.com/big',
        responseBody: JSON.stringify({ data: 'x'.repeat(5000) }),
      }),
    )
    const bundle = (await exportEvidence({ maxBytes: 200 })) as { truncations: { kind: string }[] }
    expect(bundle.truncations.length).toBeGreaterThan(0)
    await closeAll()
  })

  it('never touches the bridge (read-only tool)', async () => {
    store.add(makeGenRequest({ url: 'https://api.example.com/x' }))
    await exportEvidence()
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('a focusRequestId excluded by urlContains/query filters falls back instead of emptying the bundle', async () => {
    // focal is a real, currently-captured request — but it doesn't match
    // `/fail/`, so it's filtered out of `pool` before `focusRequestId` is
    // resolved against the full store. The bundle must still contain
    // requests, not silently come back empty while claiming to be "about"
    // the (excluded) focal id.
    const focal = makeGenRequest({ url: 'https://api.example.com/ok', status: 200 })
    store.add(focal)
    store.add(makeGenRequest({ url: 'https://api.example.com/fail/1', status: 500 }))

    const bundle = (await exportEvidence({
      focusRequestId: focal.id,
      urlContains: '/fail/',
      maxBytes: 300,
    })) as {
      isError?: boolean
      requests: { id: string }[]
      focusRequestId: string
      truncations: { kind: string }[]
    }

    expect(bundle.isError).toBeFalsy()
    expect(bundle.requests.length).toBeGreaterThan(0)
    expect(bundle.truncations.some((t) => t.kind === 'focusRequestId.not-found.fallback')).toBe(true)
    await closeAll()
  })
})

/** Echoes a `request.replay` command back as a newly-captured request bearing the marker header, deferred one tick so `awaitReplayResult`'s subscription (established right after `dispatch` returns) is already in place. */
class ReplayEchoSender implements ControlSender {
  connected = true
  sent: ControlCommand[] = []
  constructor(
    private store: RequestStore,
    private replayedOverrides: Partial<NetworkRequest> = {},
  ) {}

  sendControl(cmd: ControlCommand): boolean {
    if (!this.connected) return false
    this.sent.push(cmd)
    if (cmd.kind === 'request.replay' && cmd.replayMarker) {
      const marker = cmd.replayMarker
      setTimeout(() => {
        this.store.add(
          makeRequest({
            id: `replayed-${marker}`,
            url: 'https://api.example.com/replayed',
            method: 'GET',
            status: 200,
            responseBody: '{"ok":true}',
            requestHeaders: { [REPLAY_MARKER_HEADER]: marker },
            ...this.replayedOverrides,
          }),
        )
      }, 0)
    }
    return true
  }
}

describe('replay_request', () => {
  let store: RequestStore
  let spanStore: SpanStore
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  // Takes a factory (not a sender instance) so `store` exists BEFORE the
  // sender is constructed — a `ReplayEchoSender` needs a live store
  // reference to echo the replay back into.
  async function setup<T extends ControlSender>(makeSender: (store: RequestStore) => T): Promise<T> {
    store = new RequestStore(50)
    spanStore = new SpanStore(50)
    const sender = makeSender(store)
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
    return sender
  }

  it('replays a client-runtime request and returns the recaptured result', async () => {
    await setup((s) => new ReplayEchoSender(s))
    store.add(makeRequest({ id: 'orig-1', runtime: 'client', method: 'GET', url: 'https://api.example.com/x' }))

    const result = await client.callTool({
      name: 'replay_request',
      arguments: { requestId: 'orig-1', timeoutMs: 1000 },
    })
    expect(result.isError).toBeFalsy()
    const { replayed } = JSON.parse((result.content as { text: string }[])[0]!.text) as { replayed: NetworkRequest }
    expect(replayed.status).toBe(200)
    await closeAll()
  })

  it('is isError not_found for an unknown requestId', async () => {
    await setup((s) => new ReplayEchoSender(s))
    const result = await client.callTool({ name: 'replay_request', arguments: { requestId: 'nope' } })
    expect(result.isError).toBe(true)
    await closeAll()
  })

  it('§A: is isError runtime_not_replayable for a server-captured request, and never dispatches', async () => {
    const sender = await setup((s) => new ReplayEchoSender(s))
    store.add(makeRequest({ id: 'srv-1', runtime: 'server', method: 'GET', url: 'https://api.example.com/rsc' }))

    const result = await client.callTool({ name: 'replay_request', arguments: { requestId: 'srv-1' } })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(parsed.error).toBe('runtime_not_replayable')
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('§A: is isError runtime_not_replayable for an edge-captured request', async () => {
    await setup((s) => new ReplayEchoSender(s))
    store.add(makeRequest({ id: 'edge-1', runtime: 'edge', method: 'GET', url: 'https://api.example.com/mw' }))

    const result = await client.callTool({ name: 'replay_request', arguments: { requestId: 'edge-1' } })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(parsed.error).toBe('runtime_not_replayable')
    await closeAll()
  })

  it('is isError websocket_not_replayable for a websocket-sourced request', async () => {
    const sender = await setup((s) => new ReplayEchoSender(s))
    store.add(makeRequest({ id: 'ws-1', source: 'websocket', url: 'wss://api.example.com/rt' }))

    const result = await client.callTool({ name: 'replay_request', arguments: { requestId: 'ws-1' } })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(parsed.error).toBe('websocket_not_replayable')
    expect(sender.sent.length).toBe(0)
    await closeAll()
  })

  it('is isError bridge_disconnected when the bridge is unreachable', async () => {
    await setup((s) => {
      const sender = new ReplayEchoSender(s)
      sender.connected = false
      return sender
    })
    store.add(makeRequest({ id: 'orig-2', runtime: 'client', url: 'https://api.example.com/x' }))

    const result = await client.callTool({ name: 'replay_request', arguments: { requestId: 'orig-2' } })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(parsed.error).toBe('bridge_disconnected')
    await closeAll()
  })

  it('times out with a structured error when no replay lands', async () => {
    await setup(() => new FakeSender()) // plain sender — never echoes a replay back
    store.add(makeRequest({ id: 'orig-3', runtime: 'client', url: 'https://api.example.com/x' }))

    const result = await client.callTool({ name: 'replay_request', arguments: { requestId: 'orig-3', timeoutMs: 50 } })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(parsed.error).toBe('timeout')
    await closeAll()
  }, 2000)
})

describe('verify_fix', () => {
  let store: RequestStore
  let spanStore: SpanStore
  let mcpServer: McpServerCls
  let client: Client
  let closeAll: () => Promise<void>

  // Same store-before-sender ordering as replay_request's setup — see its comment.
  async function setup<T extends ControlSender>(makeSender: (store: RequestStore) => T): Promise<T> {
    store = new RequestStore(50)
    spanStore = new SpanStore(50)
    const sender = makeSender(store)
    mcpServer = new McpServerCls({ name: 'test', version: '0.0.0' })
    registerTools(mcpServer, store, sender, spanStore)
    registerResources(mcpServer, store)

    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    await mcpServer.connect(serverTransport)
    client = new Client({ name: 'test-client', version: '0.0.0' })
    await client.connect(clientTransport)

    closeAll = async () => {
      await client.close()
      await mcpServer.close()
    }
    return sender
  }

  it('replays, checks expect.status, and reports passed:true on a match', async () => {
    await setup((s) => new ReplayEchoSender(s, { status: 200 }))
    store.add(makeRequest({ id: 'orig-1', runtime: 'client', url: 'https://api.example.com/x' }))

    const result = await client.callTool({
      name: 'verify_fix',
      arguments: { requestId: 'orig-1', expect: { status: 200 }, timeoutMs: 1000 },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      passed: boolean
      violations: unknown[]
    }
    expect(parsed.passed).toBe(true)
    expect(parsed.violations).toEqual([])
    await closeAll()
  })

  it('reports a violation and passed:false on a status mismatch', async () => {
    await setup((s) => new ReplayEchoSender(s, { status: 500 }))
    store.add(makeRequest({ id: 'orig-1', runtime: 'client', url: 'https://api.example.com/x' }))

    const result = await client.callTool({
      name: 'verify_fix',
      arguments: { requestId: 'orig-1', expect: { status: 200 }, timeoutMs: 1000 },
    })
    expect(result.isError).toBeFalsy()
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      passed: boolean
      violations: { rule: string }[]
    }
    expect(parsed.passed).toBe(false)
    expect(parsed.violations.some((v) => v.rule === 'expect-status')).toBe(true)
    await closeAll()
  })

  it('installs the inline mock (mock.add) before replaying, in order', async () => {
    const sender = await setup((s) => new ReplayEchoSender(s, { status: 200 }))
    store.add(makeRequest({ id: 'orig-1', runtime: 'client', url: 'https://api.example.com/x' }))

    await client.callTool({
      name: 'verify_fix',
      arguments: { requestId: 'orig-1', mock: { pattern: '/x', status: 200, body: '{"fixed":true}' }, timeoutMs: 1000 },
    })
    expect(sender.sent.map((c) => c.kind)).toEqual(['mock.add', 'request.replay'])
    const mockCmd = sender.sent[0] as { kind: 'mock.add'; rule: { pattern: string } }
    expect(mockCmd.rule.pattern).toBe('/x')
    await closeAll()
  })

  it('§A: is isError runtime_not_replayable but still sends the mock first when one was given', async () => {
    const sender = await setup((s) => new ReplayEchoSender(s))
    store.add(makeRequest({ id: 'srv-1', runtime: 'server', url: 'https://api.example.com/rsc' }))

    const result = await client.callTool({
      name: 'verify_fix',
      arguments: { requestId: 'srv-1', mock: { pattern: '/rsc' }, expect: { status: 200 } },
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(parsed.error).toBe('runtime_not_replayable')
    expect(sender.sent.map((c) => c.kind)).toEqual(['mock.add'])
    await closeAll()
  })

  it('is isError bridge_disconnected on the mock.add step', async () => {
    await setup((s) => {
      const sender = new ReplayEchoSender(s)
      sender.connected = false
      return sender
    })
    store.add(makeRequest({ id: 'orig-1', runtime: 'client', url: 'https://api.example.com/x' }))

    const result = await client.callTool({
      name: 'verify_fix',
      arguments: { requestId: 'orig-1', mock: { pattern: '/x' } },
    })
    expect(result.isError).toBe(true)
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text)
    expect(parsed.error).toBe('bridge_disconnected')
    expect(parsed.step).toBe('mock.add')
    await closeAll()
  })

  it('flags maxDurationMs violations without the unrelated default max-failures rule firing', async () => {
    await setup((s) => new ReplayEchoSender(s, { status: 200, duration: 5000 }))
    store.add(makeRequest({ id: 'orig-1', runtime: 'client', url: 'https://api.example.com/x' }))

    const result = await client.callTool({
      name: 'verify_fix',
      arguments: { requestId: 'orig-1', maxDurationMs: 100, timeoutMs: 1000 },
    })
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text) as { violations: { rule: string }[] }
    expect(parsed.violations.some((v) => v.rule === 'max-duration-ms')).toBe(true)
    expect(parsed.violations.some((v) => v.rule === 'max-failures')).toBe(false)
    await closeAll()
  })

  it('is isError not_found for an unknown requestId', async () => {
    await setup((s) => new ReplayEchoSender(s))
    const result = await client.callTool({ name: 'verify_fix', arguments: { requestId: 'nope' } })
    expect(result.isError).toBe(true)
    await closeAll()
  })
})
