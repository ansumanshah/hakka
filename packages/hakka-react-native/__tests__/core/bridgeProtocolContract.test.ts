import { parseBridgeMessage } from 'hakka-bridge'
import { parseRuntimeControlMessage } from 'hakka-core'
/**
 * Wire-protocol contract — every frame type HakkaBridge actually puts on the
 * WebSocket must be recognised by `hakka-bridge`'s `parseBridgeMessage`.
 *
 * This is the class of bug three separate findings hit independently:
 * `console:log` (raw console capture), `storage:update` (the AsyncStorage/MMKV
 * monitors), and `queries:update` (the react-query monitors) were all ad hoc
 * frame types with no branch in `parseBridgeMessage` — `BridgeHub.ingest`
 * calls it directly with no fallback, so every one of those frames was
 * silently dropped before reaching a desktop peer. A type-only assertion
 * ("HakkaBridge sends `{type:'console', ...}`") doesn't catch this class of
 * bug; only round-tripping the literal wire bytes through the real parser
 * does.
 */
import { logStore } from 'hakka-core'
import type { LogEntry } from 'hakka-core'

import { hakkaBridge } from '../../src/core/HakkaBridge'

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  url: string

  onopen: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  sent: string[] = []

  constructor(url: string) {
    this.url = url
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.({ target: this } as unknown)
    }, 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

describe('every HakkaBridge frame is accepted by the capture or runtime protocol', () => {
  let origWebSocket: typeof WebSocket
  let wsInstance: MockWebSocket | null = null

  beforeEach(() => {
    origWebSocket = globalThis.WebSocket
    const MockBridgeWebSocket = function MockBridgeWebSocket(url: string) {
      const socket = new MockWebSocket(url)
      wsInstance = socket
      return socket
    }
    MockBridgeWebSocket.CONNECTING = MockWebSocket.CONNECTING
    MockBridgeWebSocket.OPEN = MockWebSocket.OPEN
    MockBridgeWebSocket.CLOSING = MockWebSocket.CLOSING
    MockBridgeWebSocket.CLOSED = MockWebSocket.CLOSED
    globalThis.WebSocket = MockBridgeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    hakkaBridge.disconnect()
    globalThis.WebSocket = origWebSocket
    wsInstance = null
    logStore.clear()
  })

  it('accepts every frame produced by a real connect + console/storage/request activity', async () => {
    hakkaBridge.connect('ws://localhost:3000')
    await new Promise((resolve) => setTimeout(resolve, 5))
    const ws = wsInstance!

    // Raw console.* capture (the fixed 'console:log' -> 'console' path).
    console.info('contract test — raw console capture')

    // Structured logStore entry (the pre-existing, already-correct path).
    const entry: LogEntry = { id: 'contract-log-1', timestamp: 1, level: 'info', message: 'structured entry' }
    logStore.add(entry)

    // Direct sanctioned-surface sends.
    hakkaBridge.sendStorage({ store: 'contract-test', timestamp: 1, entries: { a: 'b' } })
    hakkaBridge.emit('request', { id: 'contract-req-1', url: 'https://example.com', method: 'GET' })

    expect(ws.sent.length).toBeGreaterThan(0)

    const rejected = ws.sent.filter(
      (raw) => parseBridgeMessage(raw) === null && parseRuntimeControlMessage(JSON.parse(raw)) === null,
    )
    expect(rejected).toEqual([])
  })

  it('rejects the ad hoc types this class of bug used to send — documents the guardrail', () => {
    // These are the exact three frame shapes the fixed findings used to put
    // on the wire directly. If any of these ever start passing, the wire
    // protocol changed underneath the SDK and the routing fixes in
    // HakkaBridge.ts/monitors/storage.ts/monitors/reactQuery.ts need review.
    expect(
      parseBridgeMessage(JSON.stringify({ type: 'console:log', payload: { level: 'log', message: 'x' } })),
    ).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'storage:update', payload: { key: 'a', value: 'b' } }))).toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'queries:update', payload: { queryKey: 'a' } }))).toBeNull()
  })

  it('sanity: the canonical types this contract actually protects are accepted', () => {
    expect(parseBridgeMessage(JSON.stringify({ type: 'request', payload: { id: 'r1' } }))).not.toBeNull()
    expect(
      parseBridgeMessage(
        JSON.stringify({ type: 'console', payload: [{ id: 'l1', timestamp: 1, level: 'info', message: 'm' }] }),
      ),
    ).not.toBeNull()
    expect(
      parseBridgeMessage(JSON.stringify({ type: 'storage', payload: { store: 's', timestamp: 1, entries: {} } })),
    ).not.toBeNull()
    expect(parseBridgeMessage(JSON.stringify({ type: 'control', payload: {} }))).not.toBeNull()
  })
})
