import { describe, expect, test } from 'bun:test'

import { checkCaptureSourceConformance, type CaptureSourceProbe } from '../../contract/conformance'
import { createWebSocketCaptureSource } from '../websocket'

/**
 * Deliberately a SEPARATE file from `websocket.test.ts`, not a `describe` block appended to
 * it: that file's module-level `beforeEach` calls `enableWebSocketInterceptor` for every test
 * (Bun/Jest semantics), which would collide with `enableWebSocketInterceptor`'s idempotent-start
 * guard — a conformance test riding that setup would find the interceptor already started
 * against a different callback, so `ctx.ingest` here would never be reached.
 */

// Minimal fake WebSocket — same shape as websocket.test.ts's, duplicated locally since
// that file's class is private/unexported (see doc above for why setup isn't shared).
type EventHandler = (event: unknown) => void

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readonly url: string
  private _listeners: Map<string, EventHandler[]> = new Map()

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

  dispatchFakeEvent(type: string, event: unknown): void {
    const handlers = this._listeners.get(type) ?? []
    for (const h of handlers) h(event)
  }

  send(_data: unknown): void {}
}

function installFakeWebSocketGlobal(): void {
  ;(globalThis as Record<string, unknown>).WebSocket = class extends FakeWebSocket {}
  const Ctor = (globalThis as Record<string, unknown>).WebSocket as typeof FakeWebSocket
  Object.defineProperty(Ctor, 'CONNECTING', { value: 0, configurable: true })
  Object.defineProperty(Ctor, 'OPEN', { value: 1, configurable: true })
  Object.defineProperty(Ctor, 'CLOSING', { value: 2, configurable: true })
  Object.defineProperty(Ctor, 'CLOSED', { value: 3, configurable: true })
}

/** Construct through whatever `globalThis.WebSocket` currently is — the patched interceptor
 * class while a source is started, the plain fake once it's torn down. */
function connect(url = 'wss://api.example.com/ws'): FakeWebSocket {
  return new (globalThis.WebSocket as unknown as new (url: string) => FakeWebSocket)(url)
}

/** One macrotask tick — see the conformance-probe doc below for why every
 * `triggerOnce()` call goes through this before dispatching. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Yields a macrotask (`flush()`) BEFORE constructing a connection and firing one 'message'
 * event — mirroring spanProcessor.test.ts's own probe. This lets the harness's "work in
 * flight when stop() is called" check interleave a real `source.stop()` between
 * `triggerOnce()` starting and its event firing: the await suspends at `flush()`, `stop()`
 * completes well before the 0ms timer fires, so the 'message' event always lands on an
 * ALREADY-torn-down source — proving the wrapper's `stopped` flag actually suppresses it,
 * not that nothing was ever in flight. For every other check this delay is harmless: the
 * single 'message' event always reaches `ctx.ingest` deterministically once `triggerOnce`
 * is awaited to completion (enableWebSocketInterceptor's scheduleEmit fires immediately on
 * a fresh connection).
 */
function createWebSocketProbe(): CaptureSourceProbe {
  return {
    createSource() {
      installFakeWebSocketGlobal()
      return createWebSocketCaptureSource()
    },
    async triggerOnce() {
      await flush()
      const ws = connect()
      ws.dispatchFakeEvent('message', { data: 'conformance-ping' })
    },
  }
}

describe('createWebSocketCaptureSource — CaptureSource conformance', () => {
  test('all 7 lifecycle checks pass against the real wrapper', async () => {
    const report = await checkCaptureSourceConformance(createWebSocketProbe())
    expect(
      report.checks.map((c) => `${c.passed ? 'PASS' : 'FAIL'}: ${c.name}${c.detail ? ` (${c.detail})` : ''}`),
    ).toEqual(report.checks.map((c) => `PASS: ${c.name}`))
    expect(report.passed).toBe(true)
  })

  test('identity and correlation match ADR 0006 row 3', () => {
    const source = createWebSocketCaptureSource()
    expect(source.id).toBe('hakka.websocket')
    expect(source.runtime).toBe('client')
    expect(source.transport).toBe('websocket')
    expect(source.correlation).toBe('none')
  })
})
