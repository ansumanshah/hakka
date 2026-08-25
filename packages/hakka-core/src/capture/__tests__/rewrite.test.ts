import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { breakpointEngine } from '../../engine/BreakpointEngine'
import { mockEngine, type MockRequestContext, type MockResponseContext, type MockRule } from '../../engine/MockEngine'
import type { NetworkRequest } from '../../model/types'
import { configureBodyRedaction } from '../../utils/bodyRedaction'
import { enableFetchInterceptor } from '../fetch'
import { setStackCapture } from '../stackTrace'

// These tests drive the real fetch interceptor against the singleton
// MockEngine, so each test clears rules and fully restores global fetch.
const REAL_FETCH = globalThis.fetch
const MAX_BODY = 1_000_000

interface StubCall {
  input: unknown
  init: RequestInit | undefined
}

/** Install a stub as the underlying network, capturing calls, then enable the interceptor. */
function withInterceptor(stub: (input: unknown, init: RequestInit | undefined) => Promise<Response>): {
  records: NetworkRequest[]
  calls: StubCall[]
  dispose: () => void
} {
  const calls: StubCall[] = []
  const records: NetworkRequest[] = []
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    calls.push({ input, init })
    return stub(input, init)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
  const dispose = enableFetchInterceptor((r) => records.push(r), MAX_BODY, [])
  return { records, calls, dispose }
}

function makeRule(partial: Partial<MockRule>): Parameters<typeof mockEngine.addRule>[0] {
  return {
    pattern: 'api.example.com/data',
    response: { status: 200, body: 'STATIC' },
    enabled: true,
    ...partial,
  } as Parameters<typeof mockEngine.addRule>[0]
}

beforeEach(() => {
  mockEngine.clearRules()
})

afterEach(() => {
  mockEngine.clearRules()
  globalThis.fetch = REAL_FETCH
})

describe('MockEngine — rewrite/bodyProvider helpers', () => {
  const ctx: MockRequestContext = { url: 'https://api.example.com/data', method: 'GET', headers: {} }

  test('isRewrite reflects rule.mode', () => {
    const mock = { mode: 'mock' } as MockRule
    const rewrite = { mode: 'rewrite' } as MockRule
    expect(mockEngine.isRewrite(mock)).toBe(false)
    expect(mockEngine.isRewrite(rewrite)).toBe(true)
  })

  test('peek() does not record a hit; recordHit() and match() do', () => {
    mockEngine.clearRules()
    mockEngine.addRule({ pattern: 'api.example.com/data', response: { status: 200, body: 'x' }, enabled: true })
    const peeked = mockEngine.peek('https://api.example.com/data', 'GET')
    expect(peeked?.hitCount).toBe(0) // peek must not inflate the count
    mockEngine.recordHit(peeked!)
    expect(mockEngine.getRules()[0].hitCount).toBe(1)
    mockEngine.match('https://api.example.com/data', 'GET')
    expect(mockEngine.getRules()[0].hitCount).toBe(2) // match = peek + recordHit
    mockEngine.clearRules()
  })

  test('resolveMockBody awaits bodyProvider, stringifies objects', async () => {
    const rule = { response: { status: 200, body: 'STATIC', bodyProvider: () => ({ dynamic: true }) } } as MockRule
    expect(await mockEngine.resolveMockBody(rule, ctx)).toBe('{"dynamic":true}')
  })

  test('resolveMockBody falls back to static body when provider throws', async () => {
    const rule = {
      response: {
        status: 200,
        body: 'STATIC',
        bodyProvider: () => {
          throw new Error('boom')
        },
      },
    } as MockRule
    expect(await mockEngine.resolveMockBody(rule, ctx)).toBe('STATIC')
  })

  test('applyRewriteRequest returns original when not rewrite mode', async () => {
    const rule = { mode: 'mock', rewriteRequest: (r: MockRequestContext) => ({ ...r, url: 'x' }) } as MockRule
    expect(await mockEngine.applyRewriteRequest(rule, ctx)).toBe(ctx)
  })

  test('applyRewriteResponse returns original on throw', async () => {
    const res: MockResponseContext = { status: 200, headers: {}, body: 'B' }
    const rule = {
      mode: 'rewrite',
      rewriteResponse: () => {
        throw new Error('boom')
      },
    } as MockRule
    expect(await mockEngine.applyRewriteResponse(rule, res, ctx)).toBe(res)
  })

  test('isRewrite is true for a modify-only rule (no mode, no redirectTo, no function hooks)', () => {
    const modifyOnly = { modify: { status: 201 } } as MockRule
    expect(mockEngine.isRewrite(modifyOnly)).toBe(true)
  })
})

describe('fetch interceptor — mock mode bodyProvider', () => {
  test('serves dynamic bodyProvider output without hitting the network', async () => {
    mockEngine.addRule(
      makeRule({
        response: {
          status: 201,
          body: 'STATIC',
          bodyProvider: (req) => `dynamic:${req.method}:${req.url}`,
        },
      }),
    )
    const { records, calls, dispose } = withInterceptor(async () => new Response('REAL'))
    try {
      const res = await globalThis.fetch('https://api.example.com/data', { method: 'POST' })
      expect(await res.text()).toBe('dynamic:POST:https://api.example.com/data')
      expect(res.status).toBe(201)
      expect(calls.length).toBe(0) // network never touched
      expect(records.at(-1)?.mocked).toBe(true)
      expect(records.at(-1)?.responseBody).toBe('dynamic:POST:https://api.example.com/data')
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — rewrite mode', () => {
  test('rewriteResponse transforms the real response and records rewritten', async () => {
    mockEngine.addRule(
      makeRule({
        mode: 'rewrite',
        rewriteResponse: (res) => ({ ...res, status: 418, body: res.body.toUpperCase() }),
      }),
    )
    const { records, calls, dispose } = withInterceptor(async () => new Response('real-body', { status: 200 }))
    try {
      const res = await globalThis.fetch('https://api.example.com/data')
      expect(calls.length).toBe(1) // real network WAS hit
      expect(res.status).toBe(418)
      expect(await res.text()).toBe('REAL-BODY')
      const rec = records.at(-1)
      expect(rec?.rewritten).toBe(true)
      expect(rec?.mocked).toBe(false)
      expect(rec?.status).toBe(418)
      expect(rec?.responseBody).toBe('REAL-BODY')
    } finally {
      dispose()
    }
  })

  test('rewriteRequest changes the outgoing request URL', async () => {
    mockEngine.addRule(
      makeRule({
        mode: 'rewrite',
        rewriteRequest: (req) => ({ ...req, url: 'https://api.example.com/data?rewritten=1' }),
      }),
    )
    const { calls, dispose } = withInterceptor(async () => new Response('real'))
    try {
      await globalThis.fetch('https://api.example.com/data')
      expect(calls.length).toBe(1)
      expect(calls[0].input).toBe('https://api.example.com/data?rewritten=1')
    } finally {
      dispose()
    }
  })

  test('passthrough rewrite rule (no hooks) returns the real response unchanged', async () => {
    mockEngine.addRule(makeRule({ mode: 'rewrite' }))
    const { records, calls, dispose } = withInterceptor(async () => new Response('untouched', { status: 200 }))
    try {
      const res = await globalThis.fetch('https://api.example.com/data')
      expect(calls.length).toBe(1)
      expect(await res.text()).toBe('untouched')
      expect(records.at(-1)?.rewritten).toBe(true)
    } finally {
      dispose()
    }
  })

  test('a request-changing rewrite preserves credentials/mode/signal from the original init', async () => {
    mockEngine.addRule(
      makeRule({
        mode: 'rewrite',
        rewriteRequest: (req) => ({ ...req, url: 'https://api.example.com/data?rewritten=1' }),
      }),
    )
    const { calls, dispose } = withInterceptor(async () => new Response('real'))
    const controller = new AbortController()
    try {
      await globalThis.fetch('https://api.example.com/data', {
        credentials: 'include',
        mode: 'cors',
        signal: controller.signal,
      })
      expect(calls.length).toBe(1)
      expect(calls[0].init?.credentials).toBe('include')
      expect(calls[0].init?.mode).toBe('cors')
      expect(calls[0].init?.signal).toBe(controller.signal)
    } finally {
      dispose()
    }
  })

  test('a rewrite that changes method to GET never attaches a body to the real fetch', async () => {
    mockEngine.addRule(
      makeRule({
        mode: 'rewrite',
        rewriteRequest: (req) => ({ ...req, method: 'GET' }),
      }),
    )
    const { calls, dispose } = withInterceptor(async () => new Response('real'))
    try {
      await globalThis.fetch('https://api.example.com/data', { method: 'POST', body: 'payload' })
      expect(calls.length).toBe(1)
      expect(calls[0].init?.method).toBe('GET')
      expect(calls[0].init?.body).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

// Includes the cheap "query" pre-check before JSON.parse.
describe('fetch interceptor — GraphQL extraction', () => {
  const ok = async () => new Response('{}', { status: 200 })

  test('populates graphql for a GraphQL POST body (explicit operationName + variables)', async () => {
    const { records, dispose } = withInterceptor(ok)
    try {
      await globalThis.fetch('https://api.example.com/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: 'query GetUser($id: ID!) { user(id: $id) { id } }',
          operationName: 'GetUser',
          variables: { id: '1' },
        }),
      })
      expect(records.at(-1)?.graphql).toEqual({
        operationType: 'query',
        operationName: 'GetUser',
        variables: { id: '1' },
      })
    } finally {
      dispose()
    }
  })

  test('derives operationName from the query when not supplied', async () => {
    const { records, dispose } = withInterceptor(ok)
    try {
      await globalThis.fetch('https://api.example.com/graphql', {
        method: 'POST',
        body: JSON.stringify({ query: 'mutation CreatePost { createPost { id } }' }),
      })
      expect(records.at(-1)?.graphql?.operationType).toBe('mutation')
      expect(records.at(-1)?.graphql?.operationName).toBe('CreatePost')
    } finally {
      dispose()
    }
  })

  test('non-GraphQL POST bodies are skipped by the pre-check (no graphql, no false parse)', async () => {
    const { records, dispose } = withInterceptor(ok)
    try {
      await globalThis.fetch('https://api.example.com/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'ada', email: 'ada@example.com' }),
      })
      expect(records.at(-1)?.graphql).toBeUndefined()
    } finally {
      dispose()
    }
  })
})

// Locks in the observable output of the combined (single-parse) path, where redaction and
// GraphQL extraction share one JSON.parse.
describe('fetch interceptor — GraphQL body with body redaction active', () => {
  afterEach(() => configureBodyRedaction([]))

  test('graphql metadata stays correct AND the recorded body is redacted', async () => {
    configureBodyRedaction(['variables'])
    const { records, dispose } = withInterceptor(async () => new Response('{}', { status: 200 }))
    try {
      await globalThis.fetch('https://api.example.com/graphql', {
        method: 'POST',
        body: JSON.stringify({
          query: 'query GetUser($id: ID!) { user(id: $id) { id } }',
          operationName: 'GetUser',
          variables: { id: 'super-secret-user-id' },
        }),
      })
      const rec = records.at(-1)

      // GraphQL metadata is still extracted correctly...
      expect(rec?.graphql?.operationType).toBe('query')
      expect(rec?.graphql?.operationName).toBe('GetUser')
      // ...but a redacted field's real value never leaks into the graphql summary — derived
      // from the post-redaction value.
      expect(rec?.graphql?.variables).toBeUndefined()

      // The recorded requestBody carries the same redaction.
      const body = JSON.parse(rec?.requestBody ?? 'null') as {
        query: string
        operationName: string
        variables: string
      }
      expect(body.variables).toBe('[REDACTED]')
      expect(body.operationName).toBe('GetUser')
      expect(body.query).toContain('GetUser')
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — initiator stack capture', () => {
  afterEach(() => setStackCapture(false))

  test('no initiator by default (opt-in, zero overhead)', async () => {
    const { records, dispose } = withInterceptor(async () => new Response('{}'))
    try {
      await globalThis.fetch('https://api.example.com/data')
      expect(records.at(-1)?.initiator).toBeUndefined()
    } finally {
      dispose()
    }
  })

  test('captures the app call site when enabled, stripping Hakka frames', async () => {
    setStackCapture(true)
    const { records, dispose } = withInterceptor(async () => new Response('{}'))
    try {
      await globalThis.fetch('https://api.example.com/data')
      const initiator = records.at(-1)?.initiator
      expect(typeof initiator).toBe('string')
      expect((initiator ?? '').length).toBeGreaterThan(0)
      // Hakka's own interceptor frames are stripped.
      expect(initiator ?? '').not.toMatch(/capture[/\\](fetch|stackTrace)/)
      expect(initiator ?? '').not.toContain('captureInitiator')
      // Regression guard: this test lives under `packages/hakka-core/`, so it only produces a
      // non-empty initiator if the frame filter anchors package names to `node_modules/`
      // rather than matching as a bare substring (which would swallow every frame here).
      expect(initiator ?? '').toContain('hakka-core')
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — request breakpoints', () => {
  afterEach(() => {
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
  })

  const settle = () => new Promise((r) => setTimeout(r, 20))

  test('pauses a matching request, then resumes with edits applied to the wire + record', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/data', on: 'request', enabled: true })
    const { records, calls, dispose } = withInterceptor(async () => new Response('OK'))
    try {
      const p = globalThis.fetch('https://api.example.com/data', { method: 'GET' })
      await settle()
      const paused = breakpointEngine.getPaused()
      expect(paused.length).toBe(1)
      expect(paused[0]?.request.url).toBe('https://api.example.com/data')
      expect(calls.length).toBe(0) // not sent yet — held

      breakpointEngine.resume(paused[0]!.id, { url: 'https://api.example.com/edited', body: '{"x":1}' })
      await p
      expect(String((calls[0] as { input?: unknown }).input)).toBe('https://api.example.com/edited')
      expect(records.at(-1)?.url).toBe('https://api.example.com/edited')
      expect(records.at(-1)?.requestBody).toBe('{"x":1}')
    } finally {
      dispose()
    }
  })

  test('abort rejects the fetch and records the aborted request', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/data', on: 'request', enabled: true })
    const { records, calls, dispose } = withInterceptor(async () => new Response('OK'))
    try {
      const p = globalThis.fetch('https://api.example.com/data')
      await settle()
      const paused = breakpointEngine.getPaused()
      breakpointEngine.abort(paused[0]!.id)
      await expect(p).rejects.toThrow()
      expect(calls.length).toBe(0)
      expect(records.at(-1)?.error).toBe('Aborted by Hakka')
    } finally {
      dispose()
    }
  })

  test('non-matching request is never paused', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/other', on: 'request', enabled: true })
    const { records, dispose } = withInterceptor(async () => new Response('OK'))
    try {
      await globalThis.fetch('https://api.example.com/data')
      expect(breakpointEngine.getPaused().length).toBe(0)
      expect(records.at(-1)?.url).toBe('https://api.example.com/data')
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — response breakpoints', () => {
  afterEach(() => {
    breakpointEngine.resumeAll()
    breakpointEngine.clearBreakpoints()
  })

  const settle = () => new Promise((r) => setTimeout(r, 20))

  test('pauses after the response returns, then resumes with edited status/body applied to caller + record', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/data', on: 'response', enabled: true })
    const { records, calls, dispose } = withInterceptor(async () => new Response('ORIGINAL', { status: 200 }))
    try {
      const p = globalThis.fetch('https://api.example.com/data')
      await settle()
      expect(calls.length).toBe(1) // the request WAS sent — pause happens on the way back
      const paused = breakpointEngine.getPaused()
      expect(paused.length).toBe(1)
      expect(paused[0]?.phase).toBe('response')

      breakpointEngine.resume(paused[0]!.id, { status: 503, body: 'EDITED' })
      const res = await p
      expect(res.status).toBe(503)
      expect(await res.text()).toBe('EDITED')
      expect(records.at(-1)?.status).toBe(503)
      expect(records.at(-1)?.responseBody).toBe('EDITED')
    } finally {
      dispose()
    }
  })

  test('abort on the response phase rejects the fetch and records it', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/data', on: 'response', enabled: true })
    const { records, dispose } = withInterceptor(async () => new Response('ORIGINAL'))
    try {
      const p = globalThis.fetch('https://api.example.com/data')
      await settle()
      const paused = breakpointEngine.getPaused()
      breakpointEngine.abort(paused[0]!.id)
      await expect(p).rejects.toThrow()
      expect(records.at(-1)?.error).toBe('Aborted by Hakka')
    } finally {
      dispose()
    }
  })

  test('a "both" rule pauses on request first, then again on response', async () => {
    breakpointEngine.addBreakpoint({ pattern: '/data', on: 'both', enabled: true })
    const { calls, dispose } = withInterceptor(async () => new Response('OK'))
    try {
      const p = globalThis.fetch('https://api.example.com/data')
      await settle()
      let paused = breakpointEngine.getPaused()
      expect(paused.length).toBe(1)
      expect(paused[0]?.phase).toBe('request')
      expect(calls.length).toBe(0) // held before send

      breakpointEngine.resume(paused[0]!.id)
      await settle()
      expect(calls.length).toBe(1) // now sent, paused again on the response
      paused = breakpointEngine.getPaused()
      expect(paused.length).toBe(1)
      expect(paused[0]?.phase).toBe('response')

      breakpointEngine.resume(paused[0]!.id)
      await p
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — block + redirect rules', () => {
  test('block rule aborts the request with a network error and records it', async () => {
    mockEngine.addRule(makeRule({ block: true }))
    const { records, calls, dispose } = withInterceptor(async () => new Response('REAL'))
    try {
      await expect(globalThis.fetch('https://api.example.com/data')).rejects.toThrow()
      expect(calls.length).toBe(0) // the network is never hit
      expect(records.at(-1)?.error).toBe('Blocked by Hakka')
      expect(records.at(-1)?.status).toBeNull()
      expect(records.at(-1)?.mocked).toBe(true)
    } finally {
      dispose()
    }
  })

  test('redirectTo (Map Remote) sends the request to the target URL and records it', async () => {
    mockEngine.addRule(makeRule({ redirectTo: 'https://staging.example.com/data' }))
    const { records, calls, dispose } = withInterceptor(async () => new Response('FROM-STAGING', { status: 200 }))
    try {
      const res = await globalThis.fetch('https://api.example.com/data')
      expect(calls.length).toBe(1)
      expect(String((calls[0] as { input?: unknown }).input)).toBe('https://staging.example.com/data')
      expect(await res.text()).toBe('FROM-STAGING') // intact real response handed back
      expect(records.at(-1)?.url).toBe('https://staging.example.com/data')
      expect(records.at(-1)?.rewritten).toBe(true)
    } finally {
      dispose()
    }
  })
})

// Declarative `modify` rules — headers/query/status/body edits applied through the rewrite
// path, without any rewriteRequest/rewriteResponse function.
describe('fetch interceptor — declarative modify rules', () => {
  test('modify.removeRequestHeaders strips a header from the outgoing request (case-insensitive)', async () => {
    mockEngine.addRule(makeRule({ modify: { removeRequestHeaders: ['X-Secret'] } }))
    const { calls, dispose } = withInterceptor(async () => new Response('ok'))
    try {
      await globalThis.fetch('https://api.example.com/data', {
        headers: { 'x-secret': 'shh', 'x-keep': 'yes' },
      })
      expect(calls.length).toBe(1)
      const sentHeaders = calls[0].init?.headers as Record<string, string>
      expect(sentHeaders['x-secret']).toBeUndefined()
      expect(sentHeaders['x-keep']).toBe('yes')
    } finally {
      dispose()
    }
  })

  test('modify.setQueryParams adds a query param to the outgoing request URL', async () => {
    mockEngine.addRule(makeRule({ modify: { setQueryParams: { debug: '1' } } }))
    const { calls, dispose } = withInterceptor(async () => new Response('ok'))
    try {
      await globalThis.fetch('https://api.example.com/data')
      expect(calls.length).toBe(1)
      expect(String((calls[0] as { input?: unknown }).input)).toBe('https://api.example.com/data?debug=1')
    } finally {
      dispose()
    }
  })

  test('modify.removeQueryParams removes a query param from the outgoing request URL', async () => {
    mockEngine.addRule(makeRule({ modify: { removeQueryParams: ['token'] } }))
    const { calls, dispose } = withInterceptor(async () => new Response('ok'))
    try {
      await globalThis.fetch('https://api.example.com/data?token=secret&keep=1')
      expect(String((calls[0] as { input?: unknown }).input)).toBe('https://api.example.com/data?keep=1')
    } finally {
      dispose()
    }
  })

  test('modify.replaceBody rewrites the real response body (plain string find/replace)', async () => {
    mockEngine.addRule(makeRule({ modify: { replaceBody: [{ find: 'foo', replace: 'bar' }] } }))
    const { records, dispose } = withInterceptor(async () => new Response('hello foo world', { status: 200 }))
    try {
      const res = await globalThis.fetch('https://api.example.com/data')
      expect(await res.text()).toBe('hello bar world')
      expect(records.at(-1)?.responseBody).toBe('hello bar world')
      expect(records.at(-1)?.rewritten).toBe(true)
    } finally {
      dispose()
    }
  })

  test('modify.status overrides the real response status', async () => {
    mockEngine.addRule(makeRule({ modify: { status: 201 } }))
    const { records, dispose } = withInterceptor(async () => new Response('ok', { status: 200 }))
    try {
      const res = await globalThis.fetch('https://api.example.com/data')
      expect(res.status).toBe(201)
      expect(records.at(-1)?.status).toBe(201)
    } finally {
      dispose()
    }
  })

  test('modify.setResponseHeaders/removeResponseHeaders edit the response headers', async () => {
    mockEngine.addRule(
      makeRule({
        modify: { setResponseHeaders: { 'x-added': 'yes' }, removeResponseHeaders: ['x-drop-me'] },
      }),
    )
    const { dispose } = withInterceptor(
      async () => new Response('ok', { status: 200, headers: { 'x-drop-me': 'gone', 'x-keep': 'kept' } }),
    )
    try {
      const res = await globalThis.fetch('https://api.example.com/data')
      expect(res.headers.get('x-added')).toBe('yes')
      expect(res.headers.get('x-drop-me')).toBeNull()
      expect(res.headers.get('x-keep')).toBe('kept')
    } finally {
      dispose()
    }
  })

  test('modify composes with redirectTo: redirect first, then declarative edits on the redirected request', async () => {
    mockEngine.addRule(
      makeRule({
        redirectTo: 'https://staging.example.com/data',
        modify: { setQueryParams: { env: 'staging' } },
      }),
    )
    const { calls, dispose } = withInterceptor(async () => new Response('FROM-STAGING', { status: 200 }))
    try {
      await globalThis.fetch('https://api.example.com/data')
      expect(String((calls[0] as { input?: unknown }).input)).toBe('https://staging.example.com/data?env=staging')
    } finally {
      dispose()
    }
  })

  test('a rule with only a modify block (no mode, no rewriteRequest/rewriteResponse) still rewrites', async () => {
    mockEngine.addRule(makeRule({ modify: { setRequestHeaders: { 'x-hakka-modified': '1' } } }))
    const { calls, dispose } = withInterceptor(async () => new Response('ok'))
    try {
      await globalThis.fetch('https://api.example.com/data')
      expect(calls.length).toBe(1) // real network WAS hit — rewrite path, not mock mode
      const sentHeaders = calls[0].init?.headers as Record<string, string>
      expect(sentHeaders['x-hakka-modified']).toBe('1')
    } finally {
      dispose()
    }
  })
})

// wasm responses are never clone()d (breaks WebAssembly.instantiateStreaming()); SSE responses
// ARE cloned and read incrementally by sseCapture (bounded, cancel-at-cap).
describe('fetch interceptor — wasm/SSE body-read guards', () => {
  test('text/event-stream: incremental capture, caller stream untouched', async () => {
    const { records, dispose } = withInterceptor(
      async () => new Response('data: hi\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    try {
      const resp = await globalThis.fetch('https://api.example.com/sse')
      // The caller's own branch reads the full stream — capture's clone must not consume or block it.
      expect(await resp.text()).toBe('data: hi\n\n')
      await new Promise((r) => setTimeout(r as () => void, 50))
      // Headers-received record first, then at least the terminal SSE emit.
      expect(records.length).toBeGreaterThanOrEqual(2)
      const final = records.at(-1)!
      expect(final.responseBody).toContain('data: hi')
      expect(final.responseBodySize).toBeGreaterThan(0)
    } finally {
      dispose()
    }
  })

  test('application/wasm: no clone, body left intact for the caller', async () => {
    const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d])
    const { records, dispose } = withInterceptor(
      async () => new Response(wasm, { status: 200, headers: { 'content-type': 'application/wasm' } }),
    )
    try {
      const resp = await globalThis.fetch('https://cdn.example.com/m.wasm')
      await new Promise((r) => setTimeout(r as () => void, 20))
      expect(records).toHaveLength(1)
      expect(records[0].responseBody).toBeNull()
      expect(new Uint8Array(await resp.arrayBuffer())).toEqual(wasm)
    } finally {
      dispose()
    }
  })
})

describe('fetch interceptor — body redaction', () => {
  afterEach(() => {
    configureBodyRedaction([])
  })

  test('with configureBodyRedaction([password]), captured JSON request body has password redacted', async () => {
    configureBodyRedaction(['password'])
    const { records, dispose } = withInterceptor(async () => new Response('{"ok":true}', { status: 200 }))
    try {
      await globalThis.fetch('https://api.example.com/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'alice', password: 'hunter2' }),
      })
      // There may be 2 records (headers then body) — check the last one
      const rec = records.at(-1)
      const body = JSON.parse(rec?.requestBody ?? 'null') as { username: string; password: string }
      expect(body.password).toBe('[REDACTED]')
      expect(body.username).toBe('alice')
    } finally {
      dispose()
    }
  })

  test('with configureBodyRedaction([token]), captured JSON response body has token redacted', async () => {
    configureBodyRedaction(['token'])
    const responsePayload = JSON.stringify({ userId: 1, token: 'secret-jwt', name: 'alice' })
    const { records, dispose } = withInterceptor(
      async () => new Response(responsePayload, { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    try {
      await globalThis.fetch('https://api.example.com/auth')
      await new Promise((r) => setTimeout(r as () => void, 20))
      // The second record carries the body
      const bodyRec = records.find((r) => r.responseBody != null)
      const body = JSON.parse(bodyRec?.responseBody ?? 'null') as { userId: number; token: string; name: string }
      expect(body.token).toBe('[REDACTED]')
      expect(body.userId).toBe(1)
      expect(body.name).toBe('alice')
    } finally {
      dispose()
    }
  })

  test('without configureBodyRedaction, bodies are stored unchanged', async () => {
    // _bodyFields is [] by default — no redaction overhead
    const payload = JSON.stringify({ password: 'plaintext', name: 'bob' })
    const { records, dispose } = withInterceptor(async () => new Response('{"ok":true}', { status: 200 }))
    try {
      await globalThis.fetch('https://api.example.com/data', { method: 'POST', body: payload })
      const rec = records.at(-1)
      expect(rec?.requestBody).toBe(payload)
    } finally {
      dispose()
    }
  })
})
