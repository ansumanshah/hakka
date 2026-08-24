import { configureBodyRedaction } from 'hakka-core'
import type { LogEntry } from 'hakka-core'

import { hakkaBridge } from '../../src/core/HakkaBridge'
import { useMMKVMonitor } from '../../src/monitors/storage'

// The monitors are a single `useEffect` each. Running it inline is enough to
// exercise the patching they install, and avoids pulling in a renderer just to
// prove a redaction path is connected. `mock`-prefixed so jest's hoisting of
// `jest.mock` allows the reference.
const mockEffectCleanups: Array<(() => void) | void> = []
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: (effect: () => (() => void) | void) => {
    mockEffectCleanups.push(effect())
  },
}))

/**
 * The redaction helper itself (`redactStorageValue`/`redactStorageEntries`) is
 * covered by `__tests__/storage/redact.test.ts` — it moved to `storage/redact.ts`
 * so `StorageViewer.tsx` and `HakkaBridge.ts` can share it too. These tests prove
 * it is actually WIRED into the path a real monitor operation takes — a fix
 * that isn't connected passes a unit test and still leaks.
 */
describe('MMKV monitor forwards redacted values to the bridge', () => {
  afterEach(() => {
    configureBodyRedaction([])
    jest.restoreAllMocks()
  })

  function drive(key: string, stored: string): unknown {
    const emitted: LogEntry[] = []
    jest.spyOn(hakkaBridge, 'isConnected', 'get').mockReturnValue(true)
    jest.spyOn(hakkaBridge, 'sendConsole').mockImplementation((entries) => {
      emitted.push(...entries)
    })

    const store: Record<string, string> = { [key]: stored }
    const mmkv = {
      getString: (k: string) => store[k],
      setString: (k: string, v: string) => {
        store[k] = v
      },
      getNumber: () => undefined,
      setNumber: () => {},
      getBoolean: () => undefined,
      setBoolean: () => {},
      delete: () => {},
    }

    mockEffectCleanups.length = 0
    useMMKVMonitor(mmkv)
    mmkv.getString(key)
    for (const cleanup of mockEffectCleanups) cleanup?.()

    const entry = emitted.find((e) => (e.metadata as { key?: string } | undefined)?.key === key)
    return (entry?.metadata as { value?: unknown } | undefined)?.value
  }

  it('does not put a stored secret on the wire', () => {
    configureBodyRedaction(['token'])

    expect(drive('auth_token', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('still forwards an ordinary value', () => {
    configureBodyRedaction(['token'])

    expect(drive('theme', 'dark')).toBe('dark')
  })
})

/**
 * `hakkaBridge.connect()` typically resolves after these hooks have already
 * mounted (e.g. `SettingsViewModel`'s `loadSettings().then(() => connect())`).
 * A one-time `isConnected` check at mount misses that later connect entirely
 * — this pins the fix: the monitor must re-arm on a subsequent status change.
 */
describe('MMKV monitor re-arms when the bridge connects after mount', () => {
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

  let origWebSocket: typeof WebSocket

  beforeEach(() => {
    origWebSocket = globalThis.WebSocket
    const MockBridgeWebSocket = function MockBridgeWebSocket(url: string) {
      return new MockWebSocket(url)
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
    jest.restoreAllMocks()
  })

  it('installs the MMKV patch once the bridge connects, even though the hook mounted first', async () => {
    const store: Record<string, string> = { theme: 'dark' }
    const mmkv = {
      getString: (k: string) => store[k],
      setString: (k: string, v: string) => {
        store[k] = v
      },
      getNumber: () => undefined,
      setNumber: () => {},
      getBoolean: () => undefined,
      setBoolean: () => {},
      delete: () => {},
    }
    const originalGetString = mmkv.getString

    mockEffectCleanups.length = 0
    useMMKVMonitor(mmkv) // mounts while the bridge is still disconnected

    // Before connecting: not yet patched.
    expect(mmkv.getString).toBe(originalGetString)

    hakkaBridge.connect('ws://localhost:3000')
    await new Promise((resolve) => setTimeout(resolve, 5))

    // After connecting: the onStatus subscription re-armed the patch — this
    // is the assertion that fails without the fix (mount-time-only check).
    expect(mmkv.getString).not.toBe(originalGetString)

    for (const cleanup of mockEffectCleanups) cleanup?.()
  })
})
