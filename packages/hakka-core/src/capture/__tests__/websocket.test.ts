import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { configureBodyRedaction } from '../../utils/bodyRedaction'
import { enableWebSocketInterceptor } from '../websocket'

// Minimal fake WebSocket — lets tests dispatch events synchronously.
type EventHandler = (event: unknown) => void

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readonly url: string
  private _listeners: Map<string, EventHandler[]> = new Map()
  sentData: unknown[] = []

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, handler: EventHandler): void {
    const list = this._listeners.get(type) ?? []
    list.push(handler)
    this._listeners.set(type, list)
  }

  removeEventListener(type: string, handler: EventHandler): void {
    const list = this._listeners.get(type) ?? []
    this._listeners.set(
      type,
      list.filter((h) => h !== handler),
    )
  }

  /** Dispatch a synthetic event to all registered handlers for `type`. */
  dispatchFakeEvent(type: string, event: unknown): void {
    const handlers = this._listeners.get(type) ?? []
    for (const h of handlers) h(event)
  }

  send(data: unknown): void {
    this.sentData.push(data)
  }

  bind(this: FakeWebSocket): FakeWebSocket['send'] {
    return this.send.bind(this)
  }
}

// Setup / teardown — patch globalThis.WebSocket before enabling interceptor.
let records: NetworkRequest[]
let dispose: (() => void) | null = null
let lastFakeWs: FakeWebSocket | null = null

beforeEach(() => {
  records = []
  lastFakeWs = null

  // Install fake WebSocket
  ;(globalThis as Record<string, unknown>).WebSocket = class extends FakeWebSocket {
    constructor(url: string, _protocols?: string | string[]) {
      super(url)
      // oxlint-disable-next-line typescript/no-this-alias
      lastFakeWs = this
    }
  }
  // Copy statics expected by interceptor
  const Ctor = (globalThis as Record<string, unknown>).WebSocket as typeof FakeWebSocket
  Object.defineProperty(Ctor, 'CONNECTING', { value: 0, configurable: true })
  Object.defineProperty(Ctor, 'OPEN', { value: 1, configurable: true })
  Object.defineProperty(Ctor, 'CLOSING', { value: 2, configurable: true })
  Object.defineProperty(Ctor, 'CLOSED', { value: 3, configurable: true })

  dispose = enableWebSocketInterceptor((r) => records.push(r))
})

afterEach(() => {
  dispose?.()
  dispose = null
  lastFakeWs = null
})

function connect(url = 'wss://api.example.com/ws'): FakeWebSocket {
  // Instantiate via the patched WebSocket (which the interceptor wrapped)
  new (globalThis.WebSocket as unknown as new (url: string) => unknown)(url)
  if (!lastFakeWs) throw new Error('FakeWebSocket never created')
  return lastFakeWs
}

describe('WebSocket close event', () => {
  test('clean close (code=1000) — status===1000, error===null', () => {
    const ws = connect()
    ws.dispatchFakeEvent('close', { code: 1000, wasClean: true })

    expect(records).toHaveLength(1)
    const rec = records[0]
    expect(rec.status).toBe(1000)
    expect(rec.error).toBeNull()
  })

  test('unclean close (code=1006) — status===1006, error non-null', () => {
    const ws = connect()
    ws.dispatchFakeEvent('close', { code: 1006, wasClean: false })

    expect(records).toHaveLength(1)
    const rec = records[0]
    expect(rec.status).toBe(1006)
    expect(typeof rec.error).toBe('string')
    expect(rec.error).toContain('1006')
  })

  test('error event still emits status:null (unchanged path)', () => {
    const ws = connect()
    ws.dispatchFakeEvent('error', {})

    expect(records).toHaveLength(1)
    expect(records[0].status).toBeNull()
  })
})

// Regression: unlike emitUpdate() (which already wraps onRequest in try/catch), the 'error' and
// 'close' listeners used to call onRequest directly — a throwing listener became an uncaught
// exception during the page's own native error/close event dispatch instead of being swallowed.
describe('WebSocket error/close listeners never propagate a throwing onRequest', () => {
  test('a throwing onRequest during the error event does not throw', () => {
    dispose?.()
    dispose = enableWebSocketInterceptor(() => {
      throw new Error('listener boom')
    })
    const ws = connect()
    expect(() => ws.dispatchFakeEvent('error', {})).not.toThrow()
  })

  test('a throwing onRequest during the close event does not throw', () => {
    dispose?.()
    dispose = enableWebSocketInterceptor(() => {
      throw new Error('listener boom')
    })
    const ws = connect()
    expect(() => ws.dispatchFakeEvent('close', { code: 1000, wasClean: true })).not.toThrow()
  })
})

describe('WebSocket scheduleEmit', () => {
  test('open event fires immediately', () => {
    const ws = connect()
    ws.dispatchFakeEvent('open', {})

    expect(records).toHaveLength(1)
    expect(records[0].status).toBe(101)
  })

  test('first message in a burst fires immediately (leading edge)', () => {
    const ws = connect()
    ws.dispatchFakeEvent('message', { data: 'hello' })
    expect(records).toHaveLength(1)
  })

  test('a second message arriving while the trailing-edge timer is armed is coalesced, not double-emitted', () => {
    const ws = connect()
    ws.dispatchFakeEvent('message', { data: 'hello' })
    expect(records).toHaveLength(1)

    // Fires while debounceTimer is still armed from the first message — must NOT emit again
    // immediately, only mark pending for the trailing timer to pick up.
    ws.dispatchFakeEvent('message', { data: 'world' })
    expect(records).toHaveLength(1)
  })

  // Regression: scheduleEmit used to only arm the debounce timer when a second call was
  // re-entrant during the synchronous emitUpdate() — a later ASYNC message (how a real socket
  // actually delivers messages) found debounceTimer null and emitted immediately again, so
  // chatty sockets were never actually batched. The fix unconditionally arms a trailing-edge
  // timer after the leading emit.
  test('async messages within the debounce window coalesce into exactly one trailing emit', async () => {
    // A dedicated URL, filtered on below, isolates this assertion from any earlier test's
    // trailing-edge timer that hasn't fired yet — real (unmocked) timers, so a prior test's
    // dangling 250ms timer can land inside this test's own await window.
    const url = 'wss://api.example.com/burst-test'
    const ws = connect(url)
    const own = () => records.filter((r) => r.url === url)

    ws.dispatchFakeEvent('message', { data: 'm1' })
    expect(own()).toHaveLength(1) // leading-edge emit

    await new Promise((r) => setTimeout(r, 10))
    ws.dispatchFakeEvent('message', { data: 'm2' }) // separate async event, not re-entrant
    await new Promise((r) => setTimeout(r, 10))
    ws.dispatchFakeEvent('message', { data: 'm3' })

    // Still inside the debounce window — no further immediate emits.
    expect(own()).toHaveLength(1)

    // Wait out the window — the trailing timer fires exactly once for m2+m3.
    await new Promise((r) => setTimeout(r, 300))
    expect(own()).toHaveLength(2)
    expect(
      own()
        .at(-1)
        ?.messages?.map((m) => m.data),
    ).toEqual(['m1', 'm2', 'm3'])
  })

  test('close event clears debounceTimer before emitting', () => {
    const ws = connect()
    ws.dispatchFakeEvent('message', { data: 'msg' })
    // Close should still emit exactly once, not double-emit.
    ws.dispatchFakeEvent('close', { code: 1000, wasClean: true })
    const closeRec = records.find((r) => r.status === 1000)
    expect(closeRec).toBeDefined()
    expect(closeRec!.status).toBe(1000)
  })
})

describe('WebSocket self-skip', () => {
  test('localhost:8989 connections are not captured', () => {
    connect('ws://localhost:8989/bridge')
    // open event on bridge URL — interceptor skips before addEventListener
    if (lastFakeWs) lastFakeWs.dispatchFakeEvent('open', {})
    expect(records).toHaveLength(0)
  })

  test('localhost:8990 connections are not captured', () => {
    connect('ws://localhost:8990/bridge')
    if (lastFakeWs) lastFakeWs.dispatchFakeEvent('open', {})
    expect(records).toHaveLength(0)
  })
})

describe('WebSocket message capture', () => {
  test('incoming message is captured as received direction', () => {
    const ws = connect()
    ws.dispatchFakeEvent('message', { data: 'server-ping' })

    expect(records).toHaveLength(1)
    const msg = records[0].messages?.[0]
    expect(msg?.direction).toBe('received')
    expect(msg?.data).toBe('server-ping')
  })

  test('sent direction is captured when ws.send() is called', () => {
    const ws = connect()
    // send() is overridden by the interceptor to capture outgoing frames
    ;(ws as unknown as { send(data: string): void }).send('client-ping')

    expect(records).toHaveLength(1)
    const msg = records[0].messages?.[0]
    expect(msg?.direction).toBe('sent')
    expect(msg?.data).toBe('client-ping')
  })
})

describe('WebSocket binary frames', () => {
  test('received ArrayBuffer is base64-encoded with binary:true + correct size', () => {
    const ws = connect()
    ws.dispatchFakeEvent('message', { data: new Uint8Array([1, 2, 3, 4, 5]).buffer })

    const msg = records.at(-1)?.messages?.at(-1)
    expect(msg?.binary).toBe(true)
    expect(msg?.size).toBe(5)
    expect(msg?.data).toBe('AQIDBAU=') // base64 of [1,2,3,4,5]
  })

  test('sent TypedArray is captured as base64', () => {
    const ws = connect()
    ws.send(new Uint8Array([255, 0, 128]))

    const msg = records.at(-1)?.messages?.find((m) => m.direction === 'sent')
    expect(msg?.binary).toBe(true)
    expect(msg?.size).toBe(3)
    expect(msg?.data).toBe('/wCA') // base64 of [255,0,128]
  })
})

describe('WebSocket frame redaction', () => {
  afterEach(() => configureBodyRedaction([]))

  test('a configured field is redacted in a sent text frame', () => {
    configureBodyRedaction(['token'])
    const ws = connect()
    ;(ws as unknown as { send(data: string): void }).send('{"type":"auth","token":"sk-live-abc"}')

    const msg = records.at(-1)?.messages?.at(-1)
    expect(msg?.data).not.toContain('sk-live-abc')
    expect(msg?.data).toContain('[REDACTED]')
  })

  test('a configured field is redacted in a received text frame', () => {
    configureBodyRedaction(['session'])
    const ws = connect()
    ws.dispatchFakeEvent('message', { data: '{"session":"s-9f2b"}' })

    const msg = records.at(-1)?.messages?.at(-1)
    expect(msg?.data).not.toContain('s-9f2b')
    expect(msg?.data).toContain('[REDACTED]')
  })

  test('size reports what crossed the socket, not the redacted copy', () => {
    configureBodyRedaction(['token'])
    const ws = connect()
    const sent = '{"token":"sk-live-abc"}'
    ;(ws as unknown as { send(data: string): void }).send(sent)

    expect(records.at(-1)?.messages?.at(-1)?.size).toBe(sent.length)
  })

  test('frames pass through untouched when redaction is unconfigured', () => {
    const ws = connect()
    ws.dispatchFakeEvent('message', { data: '{"token":"sk-live-abc"}' })

    expect(records.at(-1)?.messages?.at(-1)?.data).toBe('{"token":"sk-live-abc"}')
  })
})
