import { enableWebSocketInterceptor } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  private _listeners: Map<string, Function[]> = new Map()

  constructor(
    public url: string,
    _protocols?: string | string[],
  ) {
    // Simulate open after microtask
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this._fire('open', {})
    }, 0)
  }

  addEventListener(event: string, handler: Function) {
    const list = this._listeners.get(event) ?? []
    list.push(handler)
    this._listeners.set(event, list)
  }

  send(_data: unknown) {
    // no-op for mock
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this._fire('close', {})
  }

  _fire(event: string, data: unknown) {
    for (const handler of this._listeners.get(event) ?? []) {
      handler(data)
    }
  }

  _simulateError() {
    this._fire('error', {})
  }
}

describe('WebSocket interceptor', () => {
  let captured: NetworkRequest[]
  const OrigWS = globalThis.WebSocket

  beforeEach(() => {
    captured = []
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = OrigWS
  })

  it('captures open events only (not frames)', (done) => {
    const teardown = enableWebSocketInterceptor((r) => {
      captured.push(r)
      if (captured.length === 1) {
        expect(r.source).toBe('websocket')
        expect(r.url).toBe('wss://echo.example.com')
        expect(r.status).toBe(101)
        expect(r.duration).toBeGreaterThanOrEqual(0)
        teardown()
        done()
      }
    })

    new WebSocket('wss://echo.example.com')
  })

  it('captures error events', (done) => {
    const teardown = enableWebSocketInterceptor((r) => {
      captured.push(r)
      const errorReq = captured.find((c) => c.error !== null)
      if (errorReq) {
        expect(errorReq.error).toBe('WebSocket error')
        teardown()
        done()
      }
    })

    const ws = new WebSocket('wss://fail.example.com') as unknown as MockWebSocket
    setTimeout(() => ws._simulateError(), 10)
  })

  it('restores original WebSocket on teardown', () => {
    const teardown = enableWebSocketInterceptor(() => {})
    expect(globalThis.WebSocket).not.toBe(MockWebSocket)
    teardown()
    expect(globalThis.WebSocket).toBe(MockWebSocket)
  })
})
