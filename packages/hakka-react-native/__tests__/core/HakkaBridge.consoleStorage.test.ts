/**
 * HakkaBridge — console/storage bridge senders.
 *
 * Mirrors iOS's `HakkaBridgeClient.sendConsole`/`sendStorage`: structured log
 * entries (the Logs tab's "Structured" segment, `hakka-core`'s `logStore`)
 * stream as canonical `{type:'console', payload: LogEntry[]}` frames as
 * they're added, and storage snapshots publish both on every Storage-tab
 * refresh (see `StorageViewer.tsx`) and once per installed backend right
 * after the bridge connects.
 */
import { configureBodyRedaction, Hakka, logStore } from 'hakka-core'
import type { LogEntry, StorageSnapshot } from 'hakka-core'
import { MMKV } from 'react-native-mmkv'

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

type Frame = { type: string; payload?: unknown }

function framesOf(ws: MockWebSocket, type: string): Frame[] {
  return ws.sent.map((raw) => JSON.parse(raw) as Frame).filter((f) => f.type === type)
}

describe('HakkaBridge — console/storage senders', () => {
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

    new MMKV().clearAll()
  })

  afterEach(() => {
    hakkaBridge.disconnect()
    globalThis.WebSocket = origWebSocket
    wsInstance = null
    logStore.clear()
    configureBodyRedaction([])
    ;(Hakka as unknown as { native: unknown }).native = null
  })

  async function connect(): Promise<MockWebSocket> {
    hakkaBridge.connect('ws://localhost:3000')
    await new Promise((resolve) => setTimeout(resolve, 5))
    return wsInstance!
  }

  it('streams a structured log entry as a canonical console frame as soon as it is logged', async () => {
    const ws = await connect()

    const entry: LogEntry = { id: 'log_1', timestamp: 1_700_000_000_000, level: 'info', message: 'app launched' }
    logStore.add(entry)

    const frames = framesOf(ws, 'console')
    expect(frames).toEqual([{ type: 'console', payload: [entry] }])
  })

  it('sendConsole sends a batch of entries in one frame, payload always an array', async () => {
    const ws = await connect()

    const entries: LogEntry[] = [
      { id: 'log_1', timestamp: 1, level: 'debug', message: 'a' },
      { id: 'log_2', timestamp: 2, level: 'warn', message: 'b' },
    ]
    hakkaBridge.sendConsole(entries)

    const frames = framesOf(ws, 'console')
    expect(frames).toHaveLength(1)
    expect(frames[0]!.payload).toEqual(entries)
  })

  it('sendConsole is a no-op for an empty array', async () => {
    const ws = await connect()
    hakkaBridge.sendConsole([])
    expect(framesOf(ws, 'console')).toHaveLength(0)
  })

  it('sendStorage sends a canonical storage frame', async () => {
    const ws = await connect()

    hakkaBridge.sendStorage({ store: 'test', timestamp: 123, entries: { a: 'b' } })

    const frames = framesOf(ws, 'storage')
    expect(frames).toContainEqual({
      type: 'storage',
      payload: { store: 'test', timestamp: 123, entries: { a: 'b' } },
    })
  })

  it('publishes an MMKV storage snapshot automatically right after connecting', async () => {
    const mmkv = new MMKV()
    mmkv.set('theme', 'dark')

    const ws = await connect()

    const frames = framesOf(ws, 'storage')
    const mmkvFrame = frames.find((f) => (f.payload as { store: string }).store === 'mmkv')
    expect(mmkvFrame).toBeDefined()
    expect((mmkvFrame!.payload as { entries: Record<string, string> }).entries).toEqual({ theme: 'dark' })
  })

  it('redacts the on-connect MMKV snapshot using the same redaction as the rest of the SDK', async () => {
    configureBodyRedaction(['token'])
    const mmkv = new MMKV()
    mmkv.set('authToken', 'sk-live-abc')

    const ws = await connect()

    const frames = framesOf(ws, 'storage')
    const mmkvFrame = frames.find((f) => (f.payload as { store: string }).store === 'mmkv')
    expect((mmkvFrame!.payload as { entries: Record<string, string> }).entries.authToken).toBe('[REDACTED]')
  })

  it('does not throw when no storage backend is installed', async () => {
    // AsyncStorage is never installed in this test environment (not a
    // dependency of this workspace) — connecting must still succeed and
    // must not throw from inside the WebSocket onopen handler.
    await expect(connect()).resolves.toBeDefined()
  })
})

describe('HakkaBridge — native storage relay (RN native-render mode)', () => {
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

    new MMKV().clearAll()
  })

  afterEach(() => {
    hakkaBridge.disconnect()
    globalThis.WebSocket = origWebSocket
    wsInstance = null
    logStore.clear()
    configureBodyRedaction([])
    ;(Hakka as unknown as { native: unknown }).native = null
  })

  async function connect(): Promise<MockWebSocket> {
    hakkaBridge.connect('ws://localhost:3000')
    await new Promise((resolve) => setTimeout(resolve, 5))
    return wsInstance!
  }

  it('asks the native module for a fresh storage snapshot right after connecting', async () => {
    const publishStorageSnapshots = jest.fn()
    ;(Hakka as unknown as { native: unknown }).native = { publishStorageSnapshots }

    await connect()

    expect(publishStorageSnapshots).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the native module has no publishStorageSnapshots (older binary)', async () => {
    ;(Hakka as unknown as { native: unknown }).native = {}
    await expect(connect()).resolves.toBeDefined()
  })

  it('forwards a snapshot delivered via Hakka.onNativeStorage as a canonical storage frame', async () => {
    const ws = await connect()

    const snapshot: StorageSnapshot = {
      store: 'sharedPreferences:auth_prefs',
      timestamp: 1_700_000_000_000,
      entries: { userId: 'user_42' },
    }
    // Simulates the native `onHakkaStorage` event having already been parsed and
    // dispatched by `HakkaFacade` — see `packages/hakka-core/src/engine/__tests__/
    // nativeConsoleStorage.test.ts` for the event-parsing/dispatch side.
    for (const listener of (Hakka as unknown as { storageListeners: Set<(s: StorageSnapshot) => void> })
      .storageListeners) {
      listener(snapshot)
    }

    const frames = framesOf(ws, 'storage')
    expect(frames).toContainEqual({ type: 'storage', payload: snapshot })
  })

  it('does NOT re-redact a native storage snapshot — it is already redacted on-device', async () => {
    configureBodyRedaction(['authToken'])
    const ws = await connect()

    const snapshot: StorageSnapshot = {
      store: 'sharedPreferences:auth_prefs',
      timestamp: 1,
      // A native-redacted marker ("██", from Android's `redactLogMetadata`) — distinct from
      // the JS redactor's own `[REDACTED]` marker (see the MMKV test above), proving this
      // value passed through untouched rather than being redacted again by `redactStorageEntries`.
      entries: { authToken: '██' },
    }
    for (const listener of (Hakka as unknown as { storageListeners: Set<(s: StorageSnapshot) => void> })
      .storageListeners) {
      listener(snapshot)
    }

    const frames = framesOf(ws, 'storage')
    const frame = frames.find((f) => (f.payload as StorageSnapshot).store === snapshot.store)
    expect((frame!.payload as StorageSnapshot).entries.authToken).toBe('██')
  })
})
