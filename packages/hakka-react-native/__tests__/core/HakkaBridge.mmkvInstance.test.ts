/**
 * HakkaBridge — `configureMMKVInstance`.
 *
 * `mmkv:set`/`mmkv:delete` (and the on-connect storage snapshot) used to
 * always construct `new MMKV()` — react-native-mmkv's *default* instance.
 * Any host app using a configured (named/encrypted) MMKV instance never saw
 * these writes: they landed in an unrelated, effectively empty store.
 * `configureMMKVInstance` lets the host register its real instance so these
 * paths operate on the app's actual data.
 */
import { hakkaBridge, configureMMKVInstance } from '../../src/core/HakkaBridge'

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

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as { data: unknown })
  }
}

function makeFakeMMKV() {
  const store = new Map<string, string>()
  return {
    store,
    set: jest.fn((key: string, value: string) => store.set(key, value)),
    getString: jest.fn((key: string) => store.get(key)),
    getAllKeys: jest.fn(() => Array.from(store.keys())),
    delete: jest.fn((key: string) => store.delete(key)),
  }
}

describe('HakkaBridge — configureMMKVInstance', () => {
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
    configureMMKVInstance(null)
    globalThis.WebSocket = origWebSocket
    wsInstance = null
  })

  async function connect(): Promise<MockWebSocket> {
    hakkaBridge.connect('ws://localhost:3000')
    await new Promise((resolve) => setTimeout(resolve, 5))
    return wsInstance!
  }

  it('mmkv:set writes to the registered instance, not the throwaway default one', async () => {
    const registered = makeFakeMMKV()
    configureMMKVInstance(registered)

    const ws = await connect()
    ws.emitMessage({ type: 'mmkv:set', payload: { key: 'hakka:theme', value: 'dark' } })

    expect(registered.set).toHaveBeenCalledWith('hakka:theme', 'dark')
    expect(registered.store.get('hakka:theme')).toBe('dark')
  })

  it('mmkv:delete deletes from the registered instance', async () => {
    const registered = makeFakeMMKV()
    registered.store.set('hakka:theme', 'dark')
    configureMMKVInstance(registered)

    const ws = await connect()
    ws.emitMessage({ type: 'mmkv:delete', payload: { key: 'hakka:theme' } })

    expect(registered.delete).toHaveBeenCalledWith('hakka:theme')
    expect(registered.store.has('hakka:theme')).toBe(false)
  })

  it('the on-connect storage snapshot reads from the registered instance', async () => {
    const registered = makeFakeMMKV()
    registered.store.set('authToken', 'sk-live-abc')
    configureMMKVInstance(registered)

    await connect()

    expect(registered.getAllKeys).toHaveBeenCalled()
    expect(registered.getString).toHaveBeenCalledWith('authToken')
  })

  it('falls back to the default MMKV() instance when nothing is registered', async () => {
    // No configureMMKVInstance call — this exercises the pre-existing
    // best-effort fallback, proving it still works (mocked by
    // __tests__/__mocks__/react-native-mmkv.js).
    const ws = await connect()
    expect(() => {
      ws.emitMessage({ type: 'mmkv:set', payload: { key: 'hakka:theme', value: 'dark' } })
    }).not.toThrow()
  })
})
