/**
 * storeEngine — desktop bridge wire behavior.
 *
 * These tests exercise the raw `storeEngine` module directly (not through
 * `storeClient`) because they need to inspect the fake socket's `sent` frames
 * and drive its `bufferedAmount`, which the client interface doesn't expose.
 *
 * A `FakeBridgeSocket` stands in for the browser `WebSocket` global — same
 * `readyState`/`bufferedAmount`/`send` surface storeEngine relies on, but
 * synchronous enough (after one `setTimeout(0)` tick) to drive from a test.
 */
import type { FrameworkSpan, NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createStoreClient, type StoreClient } from '../storeClient'
import { storeEngine } from '../storeEngine'

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

function span(over: Partial<FrameworkSpan> = {}): FrameworkSpan {
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

type BridgeFrame = { type: string; payload?: unknown }

class FakeBridgeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readyState = FakeBridgeSocket.CONNECTING
  bufferedAmount = 0
  sent: BridgeFrame[] = []

  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    registerSocket(this)
    // Real WebSocket handshakes async; mirror that with one macrotask so
    // storeEngine's `ws = socket` assignment always happens before `onopen`.
    setTimeout(() => {
      this.readyState = FakeBridgeSocket.OPEN
      this.onopen?.()
    }, 0)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as BridgeFrame)
  }

  close(): void {
    this.readyState = FakeBridgeSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }

  /** Simulate the hub relaying a frame from another peer. */
  emitFromHub(frame: BridgeFrame): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

let lastSocket: FakeBridgeSocket | null = null
function registerSocket(socket: FakeBridgeSocket): void {
  lastSocket = socket
}

/** Connect the bridge and wait for the fake socket's async `onopen` to fire. */
async function connectBridge(): Promise<FakeBridgeSocket> {
  storeEngine.bridgeConnect('ws://test-hub')
  await new Promise((resolve) => setTimeout(resolve, 0))
  const socket = lastSocket
  if (!socket) throw new Error('expected storeEngine to open a bridge socket')
  return socket
}

describe('storeEngine desktop bridge', () => {
  beforeEach(() => {
    lastSocket = null
    vi.stubGlobal('WebSocket', FakeBridgeSocket)
    storeEngine.init(
      undefined,
      () => {},
      () => {},
    )
  })

  afterEach(() => {
    // Tear down while the fake WebSocket is still installed — bridgeDisconnect()
    // closes the live socket instance, independent of the global stub.
    storeEngine.shutdown()
    vi.unstubAllGlobals()
  })

  it('ingests a hub-relayed request frame without echoing it back (echo suppression)', async () => {
    const socket = await connectBridge()
    socket.sent = [] // clear the (empty, no prior logs) replay-on-connect frames

    socket.emitFromHub({ type: 'request', payload: req({ id: 'server-1', runtime: 'server' }) })

    expect(storeEngine.snapshot().map((r) => r.id)).toContain('server-1')
    expect(socket.sent.some((f) => (f.payload as NetworkRequest | undefined)?.id === 'server-1')).toBe(false)
  })

  it('still forwards a genuinely local ingest over the bridge', async () => {
    const socket = await connectBridge()
    socket.sent = []

    storeEngine.ingest(req({ id: 'local-1' }))

    expect(socket.sent.some((f) => f.type === 'request' && (f.payload as NetworkRequest).id === 'local-1')).toBe(true)
  })

  it('does not suppress a second local request sharing an id with nothing bridge-relayed', async () => {
    const socket = await connectBridge()
    socket.sent = []
    socket.emitFromHub({ type: 'request', payload: req({ id: 'server-2' }) })
    socket.sent = [] // the relayed frame's own (suppressed) echo attempt, cleared

    // The suppression window only brackets the single Hakka.ingest() call for
    // the relayed frame — it must not leak into later, unrelated dispatches.
    storeEngine.ingest(req({ id: 'local-2' }))
    expect(socket.sent.some((f) => (f.payload as NetworkRequest).id === 'local-2')).toBe(true)
  })

  it('drops an outgoing frame once the socket send buffer is backed up (backpressure)', async () => {
    const socket = await connectBridge()
    socket.sent = []
    socket.bufferedAmount = 5 * 1024 * 1024 // over the 4MB threshold

    storeEngine.ingest(req({ id: 'dropped-1' }))
    expect(socket.sent).toEqual([])

    socket.bufferedAmount = 0
    storeEngine.ingest(req({ id: 'kept-1' }))
    expect(socket.sent.some((f) => (f.payload as NetworkRequest).id === 'kept-1')).toBe(true)
  })

  it('reconnect replay sends only page-originated records, never bridge-received ones', async () => {
    const socket = await connectBridge()
    socket.sent = []

    socket.emitFromHub({ type: 'request', payload: req({ id: 'from-hub-1', runtime: 'server' }) })
    storeEngine.ingest(req({ id: 'mine-1' }))
    expect(storeEngine.snapshot().map((r) => r.id)).toEqual(expect.arrayContaining(['from-hub-1', 'mine-1']))

    // Drive the reconnect deterministically — the engine's own auto-retry
    // backs off >=1s, needlessly slow for a unit test.
    storeEngine.bridgeDisconnect()
    storeEngine.bridgeConnect('ws://test-hub')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const fresh = lastSocket
    if (!fresh || fresh === socket) throw new Error('expected a fresh socket after reconnect')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const replayedIds = fresh.sent.filter((f) => f.type === 'request').map((f) => (f.payload as NetworkRequest).id)
    expect(replayedIds).toContain('mine-1')
    // The record that arrived via the bridge must not be echoed back — that
    // loop is how stale entries used to reseed every fresh hub forever.
    expect(replayedIds).not.toContain('from-hub-1')
  })
})

describe('storeEngine — span frames (Next Request Insights design doc §3/§4)', () => {
  beforeEach(() => {
    lastSocket = null
    vi.stubGlobal('WebSocket', FakeBridgeSocket)
    storeEngine.init(
      undefined,
      () => {},
      () => {},
    )
  })

  afterEach(() => {
    storeEngine.shutdown()
    vi.unstubAllGlobals()
  })

  it('ingests a hub-relayed span frame into the bounded spansByTrace store, retrievable via getSpansForTrace', async () => {
    const socket = await connectBridge()
    socket.sent = []

    socket.emitFromHub({ type: 'span', payload: span({ id: 's1', traceId: 'trace-a' }) })

    expect(storeEngine.getSpansForTrace('trace-a').map((s) => s.id)).toEqual(['s1'])
    // Relay-only — never buffered/echoed like a 'request' frame is.
    expect(socket.sent.some((f) => f.type === 'span')).toBe(false)
  })

  it('getSpansForTrace returns [] for an unknown trace', async () => {
    await connectBridge()
    expect(storeEngine.getSpansForTrace('nope')).toEqual([])
  })

  it('bounds spans per trace, evicting the oldest span within that trace once full', async () => {
    const socket = await connectBridge()
    // SPAN_PER_TRACE_MAX = 500 — push one over to trigger the shift().
    for (let i = 0; i < 501; i++) {
      socket.emitFromHub({ type: 'span', payload: span({ id: `s${i}`, traceId: 'trace-full' }) })
    }
    const spans = storeEngine.getSpansForTrace('trace-full')
    expect(spans).toHaveLength(500)
    expect(spans[0]?.id).toBe('s1') // s0 evicted, oldest-first
    expect(spans[499]?.id).toBe('s500')
  })

  it('bounds trace count, evicting the whole oldest trace once full', async () => {
    const socket = await connectBridge()
    // SPAN_TRACE_MAX = 200 — push one trace over to trigger eviction of the
    // very first trace this test opened.
    for (let i = 0; i < 201; i++) {
      socket.emitFromHub({ type: 'span', payload: span({ id: `s-${i}`, traceId: `trace-${i}` }) })
    }
    expect(storeEngine.getSpansForTrace('trace-0')).toEqual([]) // oldest trace evicted whole
    expect(storeEngine.getSpansForTrace('trace-200').map((s) => s.id)).toEqual(['s-200']) // newest survives
  })

  it('onSpan sink fires for a live span while init() was given one', async () => {
    const seen: FrameworkSpan[] = []
    storeEngine.shutdown()
    storeEngine.init(
      undefined,
      () => {},
      () => {},
      undefined,
      (s) => seen.push(s),
    )
    const socket = await connectBridge()
    socket.emitFromHub({ type: 'span', payload: span({ id: 's-live', traceId: 'trace-live' }) })
    expect(seen.map((s) => s.id)).toEqual(['s-live'])
  })
})

describe('storeClient — span subscription + spansForTrace RPC (in-process backend)', () => {
  let client: StoreClient

  beforeEach(() => {
    lastSocket = null
    vi.stubGlobal('WebSocket', FakeBridgeSocket)
    client = createStoreClient({ forceInProcess: true })
  })

  afterEach(() => {
    client.destroy()
    vi.unstubAllGlobals()
  })

  it('subscribeSpans fans out a bridge-relayed span to the client', async () => {
    const seen: FrameworkSpan[] = []
    const unsub = client.subscribeSpans!((s) => seen.push(s))

    client.bridgeConnect('ws://test-hub-2')
    const socket = await connectBridge()
    socket.emitFromHub({ type: 'span', payload: span({ id: 'sc-1', traceId: 'trace-client' }) })

    expect(seen.map((s) => s.id)).toEqual(['sc-1'])
    unsub()
  })

  it('getSpansForTrace resolves the spans held for a trace, [] for an unknown one', async () => {
    client.bridgeConnect('ws://test-hub-3')
    const socket = await connectBridge()
    socket.emitFromHub({ type: 'span', payload: span({ id: 'sc-2', traceId: 'trace-rpc' }) })

    await expect(client.getSpansForTrace!('trace-rpc')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'sc-2' })]),
    )
    await expect(client.getSpansForTrace!('nope')).resolves.toEqual([])
  })
})
