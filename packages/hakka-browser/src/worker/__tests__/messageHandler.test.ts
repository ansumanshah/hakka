import type { FrameworkSpan, NetworkRequest } from 'hakka-core'
import { afterEach, describe, expect, it } from 'vitest'

import { createStoreMessageHandler } from '../messageHandler'
import { storeEngine } from '../storeEngine'

function makeReq(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `r-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/data',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: { 'content-type': 'application/json' },
    source: 'fetch',
    ...over,
  } as any
}

function makeSpan(over: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id: `s-${Math.random().toString(36).slice(2)}`,
    traceId: 'trace-1',
    parentId: null,
    name: 'BaseServer.handleRequest',
    startTime: 0,
    endTime: 10,
    verbosity: 'primary',
    runtime: 'server',
    ...over,
  }
}

afterEach(() => {
  storeEngine.shutdown()
})

describe('messageHandler — init + subscribe + ingest', () => {
  it('emits {type:"request"} for each ingest while subscribed', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'subscribe' })

    const r = makeReq({ id: 'r1' })
    handler.handle({ type: 'ingest', req: r })

    const requestMsgs = collected.filter((m: any) => m.type === 'request') as any[]
    expect(requestMsgs).toHaveLength(1)
    expect(requestMsgs[0].req.id).toBe('r1')
  })
})

describe('messageHandler — control frames cross to the main thread', () => {
  it('wires the engine control sink to post({type:"control"})', () => {
    const collected: unknown[] = []
    // Inject a fake engine to capture the control sink init() receives — the
    // same seam storeEngine's socket.onmessage fires when a bridge control
    // frame arrives on the store thread.
    let controlSink: ((payload: unknown) => void) | undefined
    const fakeEngine = {
      ...storeEngine,
      init: (_config: unknown, _req: unknown, _bridge: unknown, control?: (payload: unknown) => void) => {
        controlSink = control
      },
    } as typeof storeEngine
    const handler = createStoreMessageHandler((msg) => collected.push(msg), fakeEngine)

    handler.handle({ type: 'init' })
    expect(controlSink).toBeDefined()

    const payload = { kind: 'mock.add', rule: { id: 'mcp-mock-1', pattern: '/x' } }
    controlSink!(payload)

    const controlMsgs = collected.filter((m) => (m as { type?: string }).type === 'control') as {
      type: string
      payload: unknown
    }[]
    expect(controlMsgs).toHaveLength(1)
    expect(controlMsgs[0]?.payload).toEqual(payload)
  })
})

describe('messageHandler — span frames (Next Request Insights design doc §5)', () => {
  it('posts {type:"span"} for a span the engine relays, only while subscribed', () => {
    const collected: unknown[] = []
    // Same seam as the "control frames" test above: inject a fake engine to
    // capture the span sink init() receives — the same seam storeEngine's
    // socket.onmessage fires when a bridge 'span' frame arrives.
    let spanSink: ((span: FrameworkSpan) => void) | undefined
    const fakeEngine = {
      ...storeEngine,
      init: (
        _config: unknown,
        _req: unknown,
        _bridge: unknown,
        _control?: (payload: unknown) => void,
        span?: (s: FrameworkSpan) => void,
      ) => {
        spanSink = span
      },
    } as typeof storeEngine
    const handler = createStoreMessageHandler((msg) => collected.push(msg), fakeEngine)

    handler.handle({ type: 'init' })
    expect(spanSink).toBeDefined()

    // Not subscribed yet — the span sink firing must not post anything.
    spanSink!(makeSpan({ id: 's-unsub' }))
    expect(collected.filter((m: any) => m.type === 'span')).toHaveLength(0)

    handler.handle({ type: 'subscribe' })
    spanSink!(makeSpan({ id: 's-sub' }))
    const spanMsgs = collected.filter((m: any) => m.type === 'span') as any[]
    expect(spanMsgs).toHaveLength(1)
    expect(spanMsgs[0].span.id).toBe('s-sub')

    handler.handle({ type: 'unsubscribe' })
    spanSink!(makeSpan({ id: 's-after-unsub' }))
    expect(collected.filter((m: any) => m.type === 'span')).toHaveLength(1) // unchanged
  })

  it('spansForTrace posts {type:"result", rid, value} from engine.getSpansForTrace', () => {
    const collected: unknown[] = []
    const spans = [makeSpan({ id: 's1', traceId: 'trace-x' })]
    const fakeEngine = {
      ...storeEngine,
      getSpansForTrace: (traceId: string) => (traceId === 'trace-x' ? spans : []),
    } as typeof storeEngine
    const handler = createStoreMessageHandler((msg) => collected.push(msg), fakeEngine)

    handler.handle({ type: 'init' })
    handler.handle({ type: 'spansForTrace', rid: 30, traceId: 'trace-x' })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results).toHaveLength(1)
    expect(results[0].rid).toBe(30)
    expect(results[0].value).toBe(spans)
  })
})

describe('messageHandler — unsubscribe stops echoes', () => {
  it('does not emit request messages after unsubscribe', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'subscribe' })
    handler.handle({ type: 'unsubscribe' })

    handler.handle({ type: 'ingest', req: makeReq({ id: 'r2' }) })

    const requestMsgs = collected.filter((m: any) => m.type === 'request')
    expect(requestMsgs).toHaveLength(0)
  })
})

describe('messageHandler — snapshot with rid correlation', () => {
  it('emits {type:"result", rid, value:[...]} containing the ingested request', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    const r = makeReq({ id: 'r3' })
    handler.handle({ type: 'ingest', req: r })
    handler.handle({ type: 'snapshot', rid: 42 })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results).toHaveLength(1)
    expect(results[0].rid).toBe(42)
    expect(Array.isArray(results[0].value)).toBe(true)
    expect((results[0].value as NetworkRequest[]).some((req) => req.id === 'r3')).toBe(true)
  })
})

describe('messageHandler — clear', () => {
  it('emits {type:"cleared"} and a subsequent snapshot returns []', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r4' }) })
    handler.handle({ type: 'clear' })

    const clearedMsgs = collected.filter((m: any) => m.type === 'cleared')
    expect(clearedMsgs).toHaveLength(1)

    handler.handle({ type: 'snapshot', rid: 7 })
    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results).toHaveLength(1)
    expect(results[0].value).toEqual([])
  })
})

describe('messageHandler — export commands', () => {
  it('exportHar returns a result whose value JSON-parses as a HAR log', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r5' }) })
    handler.handle({ type: 'exportHar', rid: 10 })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results).toHaveLength(1)
    expect(results[0].rid).toBe(10)
    expect(() => JSON.parse(results[0].value as string)).not.toThrow()
    expect(JSON.parse(results[0].value as string)).toHaveProperty('log')
  })

  it('exportPostman returns a result whose value JSON-parses', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r6' }) })
    handler.handle({ type: 'exportPostman', rid: 11 })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results).toHaveLength(1)
    expect(results[0].rid).toBe(11)
    expect(() => JSON.parse(results[0].value as string)).not.toThrow()
  })

  it('exportOtel returns a result whose value JSON-parses', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r7' }) })
    handler.handle({ type: 'exportOtel', rid: 12, options: { serviceName: 'test' } })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results).toHaveLength(1)
    expect(results[0].rid).toBe(12)
    expect(() => JSON.parse(results[0].value as string)).not.toThrow()
  })
})

describe('messageHandler — getBody / getBodies (the on-demand body RPC)', () => {
  it('getBody returns the full body pair for an ingested id', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r8', requestBody: '{"a":1}', responseBody: '{"ok":true}' }) })
    handler.handle({ type: 'getBody', rid: 20, id: 'r8' })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results).toHaveLength(1)
    expect(results[0].rid).toBe(20)
    expect(results[0].value).toEqual({ requestBody: '{"a":1}', responseBody: '{"ok":true}' })
  })

  it('getBody returns null for an id the store never had', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'getBody', rid: 21, id: 'nope' })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results[0].value).toBeNull()
  })

  it('getBodies resolves a batch, omitting ids not found', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r9', responseBody: 'one' }) })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r10', responseBody: 'two' }) })
    handler.handle({ type: 'getBodies', rid: 22, ids: ['r9', 'r10', 'missing'] })

    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results[0].value).toEqual({
      r9: { requestBody: null, responseBody: 'one' },
      r10: { requestBody: null, responseBody: 'two' },
    })
  })

  it('the live echo (subscribe) never carries bodies by default, even though getBody still can', () => {
    const collected: unknown[] = []
    const handler = createStoreMessageHandler((msg) => collected.push(msg))

    handler.handle({ type: 'init' })
    handler.handle({ type: 'subscribe' })
    handler.handle({ type: 'ingest', req: makeReq({ id: 'r11', requestBody: 'req-body', responseBody: 'res-body' }) })

    const echoed = collected.find((m: any) => m.type === 'request') as any
    expect(echoed.req.requestBody).toBeUndefined()
    expect(echoed.req.responseBody).toBeUndefined()

    handler.handle({ type: 'getBody', rid: 23, id: 'r11' })
    const results = collected.filter((m: any) => m.type === 'result') as any[]
    expect(results[0].value).toEqual({ requestBody: 'req-body', responseBody: 'res-body' })
  })
})

it('acknowledges a targeted control only after its matching main-thread result', () => {
  const messages: import('../protocol').WorkerToMain[] = []
  let control: ((payload: unknown, applied?: (ok: boolean) => void) => void) | undefined
  const engine = {
    ...storeEngine,
    init: (_config: unknown, _req: unknown, _bridge: unknown, sink: typeof control) => {
      control = sink
    },
  } as typeof storeEngine
  const handler = createStoreMessageHandler((message) => messages.push(message), engine)
  handler.handle({ type: 'init' })
  const outcomes: boolean[] = []
  control!({ kind: 'mock.clear' }, (ok) => outcomes.push(ok))
  const message = messages[0]!
  expect(message.type).toBe('control')
  if (message.type !== 'control' || message.rid === undefined) throw new Error('missing control ID')
  expect(outcomes).toEqual([])
  handler.handle({ type: 'controlApplied', rid: message.rid + 1, ok: true })
  expect(outcomes).toEqual([])
  handler.handle({ type: 'controlApplied', rid: message.rid, ok: false })
  handler.handle({ type: 'controlApplied', rid: message.rid, ok: true })
  expect(outcomes).toEqual([false])
})
