import { configureBodyRedaction } from 'hakka-core'
import type { LogEntry } from 'hakka-core'

import { hakkaBridge } from '../../src/core/HakkaBridge'
import { redactQueryData, useQueryMonitor, useReactQueryDevTools } from '../../src/monitors/reactQuery'

// Run effects inline rather than pulling in a renderer — the hook body is a
// single `useEffect`. `mock`-prefixed so jest's hoisting allows the reference.
const mockEffectCleanups: Array<(() => void) | void> = []
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: (effect: () => (() => void) | void) => {
    mockEffectCleanups.push(effect())
  },
}))

/**
 * A react-query cache holds whole API responses, so it carries exactly what the
 * network interceptors already redact — but this monitor emitted the parsed
 * object on its own channel, bypassing all of it.
 */
describe('query data redaction', () => {
  afterEach(() => configureBodyRedaction([]))

  it('passes data through untouched when nothing is configured', () => {
    const data = { user: 'ada', token: 'sk-live-abc' }

    expect(redactQueryData(data)).toEqual(data)
  })

  it('redacts a configured field', () => {
    configureBodyRedaction(['token'])

    expect(redactQueryData({ user: 'ada', token: 'sk-live-abc' })).toEqual({
      user: 'ada',
      token: '[REDACTED]',
    })
  })

  it('redacts nested and array-nested fields', () => {
    configureBodyRedaction(['password'])

    const result = redactQueryData({ users: [{ name: 'ada', password: 'hunter2' }] })

    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(JSON.stringify(result)).toContain('ada')
  })

  it('passes null and undefined through', () => {
    configureBodyRedaction(['token'])

    expect(redactQueryData(null)).toBeNull()
    expect(redactQueryData(undefined)).toBeUndefined()
  })

  it('drops an unserializable payload rather than emitting it unredacted', () => {
    configureBodyRedaction(['token'])
    const cyclic: Record<string, unknown> = { token: 'sk-live-abc' }
    cyclic.self = cyclic

    expect(redactQueryData(cyclic)).toBeUndefined()
  })

  it('leaves a primitive alone', () => {
    configureBodyRedaction(['token'])

    expect(redactQueryData(42)).toBe(42)
  })
})

/**
 * The tests above exercise the helper. This one proves it is WIRED into the
 * emit path — with only helper tests, removing the wiring left them all green.
 */
describe('query monitor forwards redacted data to the bridge', () => {
  afterEach(() => {
    configureBodyRedaction([])
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('does not put a cached secret on the wire', () => {
    jest.useFakeTimers()
    configureBodyRedaction(['token'])

    const emitted: LogEntry[] = []
    jest.spyOn(hakkaBridge, 'isConnected', 'get').mockReturnValue(true)
    jest.spyOn(hakkaBridge, 'sendConsole').mockImplementation((entries) => {
      emitted.push(...entries)
    })

    const client = {
      getQueryState: () => ({
        status: 'success',
        data: { user: 'ada', token: 'sk-live-abc' },
        error: null,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        fetchStatus: 'idle',
      }),
      getQueryCache: () => ({ subscribe: () => () => {}, getAll: () => [] }),
    } as unknown as Parameters<typeof useQueryMonitor>[1]

    mockEffectCleanups.length = 0
    useQueryMonitor([['me']], client)
    jest.advanceTimersByTime(5000)
    for (const cleanup of mockEffectCleanups) cleanup?.()

    expect(emitted.length).toBeGreaterThan(0)
    expect(JSON.stringify(emitted)).not.toContain('sk-live-abc')
    expect(JSON.stringify(emitted)).toContain('ada')
  })
})

/**
 * `useQueryMonitor`/`useReactQueryDevTools` used to fall back to
 * `require('@tanstack/react-query').getQueryClient?.()` when no `queryClient`
 * was passed — a module-level export that doesn't exist in TanStack Query v5,
 * so the optional call always resolved to `undefined` and the hook silently
 * no-opped. Both hooks now require an explicit `queryClient`.
 */
describe('queryClient must be passed explicitly — no dead auto-detect fallback', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('useQueryMonitor is a no-op (does not throw) when queryClient is omitted', () => {
    jest.spyOn(hakkaBridge, 'isConnected', 'get').mockReturnValue(true)
    const sendConsoleSpy = jest.spyOn(hakkaBridge, 'sendConsole')

    mockEffectCleanups.length = 0
    expect(() => useQueryMonitor([['me']])).not.toThrow()
    for (const cleanup of mockEffectCleanups) cleanup?.()

    expect(sendConsoleSpy).not.toHaveBeenCalled()
  })

  it('useReactQueryDevTools is a no-op (does not throw) when queryClient is omitted', () => {
    jest.spyOn(hakkaBridge, 'isConnected', 'get').mockReturnValue(true)
    const sendConsoleSpy = jest.spyOn(hakkaBridge, 'sendConsole')

    mockEffectCleanups.length = 0
    expect(() => useReactQueryDevTools()).not.toThrow()
    for (const cleanup of mockEffectCleanups) cleanup?.()

    expect(sendConsoleSpy).not.toHaveBeenCalled()
  })
})

/**
 * `useReactQueryDevTools`'s cache subscription used to call `sendAllQueries()`
 * unthrottled on every cache event — fired per fetch-stage transition, per
 * query — re-serializing and emitting the entire cache each time. This pins
 * the fix: a burst of cache events inside the throttle window collapses into
 * one trailing send, not one per event.
 */
describe('useReactQueryDevTools coalesces a burst of cache events', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('sends once for the initial mount, then once more for a burst of cache events (not once per event)', () => {
    jest.useFakeTimers()
    jest.spyOn(hakkaBridge, 'isConnected', 'get').mockReturnValue(true)
    const sendConsoleSpy = jest.spyOn(hakkaBridge, 'sendConsole').mockImplementation(() => {})

    let cacheListener: (() => void) | null = null
    const query = {
      queryKey: ['me'],
      state: { status: 'success', data: null, error: null, dataUpdatedAt: 0, errorUpdatedAt: 0, fetchStatus: 'idle' },
    }
    const client = {
      getQueryCache: () => ({
        // sendAllQueries calls sendConsole once per cached query — a non-empty
        // cache is required for the assertions below to reflect sendAllQueries
        // actually running, not just an empty forEach no-op.
        getAll: () => [query],
        subscribe: (listener: () => void) => {
          cacheListener = listener
          return () => {
            cacheListener = null
          }
        },
      }),
    } as unknown as Parameters<typeof useReactQueryDevTools>[0]

    mockEffectCleanups.length = 0
    useReactQueryDevTools(client)
    // The initial `sendAllQueries()` call on mount, before any cache event.
    expect(sendConsoleSpy).toHaveBeenCalledTimes(1)

    // A burst of 10 cache events (e.g. 10 fetch-stage transitions) within one
    // throttle window — an unthrottled subscriber would call sendAllQueries
    // 10 times here.
    for (let i = 0; i < 10; i++) cacheListener?.()
    expect(sendConsoleSpy).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(250)
    expect(sendConsoleSpy).toHaveBeenCalledTimes(2)

    for (const cleanup of mockEffectCleanups) cleanup?.()
  })
})

/**
 * `hakkaBridge.connect()` typically resolves after these hooks have already
 * mounted (e.g. `SettingsViewModel`'s `loadSettings().then(() => connect())`).
 * A one-time `isConnected` check at mount misses that later connect entirely
 * — this pins the fix: both hooks must re-arm on a subsequent status change,
 * matching `storage.ts`'s `useAsyncStorageMonitor`/`useMMKVMonitor`.
 */
describe('reactQuery monitors re-arm when the bridge connects after mount', () => {
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
        this.onopen?.({ target: this })
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

  it('useQueryMonitor starts polling once the bridge connects, even though the hook mounted first', async () => {
    const sendConsoleSpy = jest.spyOn(hakkaBridge, 'sendConsole')
    const client = {
      getQueryState: () => ({
        status: 'success',
        data: { ok: true },
        error: null,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        fetchStatus: 'idle',
      }),
      getQueryCache: () => ({ subscribe: () => () => {}, getAll: () => [] }),
    } as unknown as Parameters<typeof useQueryMonitor>[1]

    mockEffectCleanups.length = 0
    useQueryMonitor([['me']], client) // mounts while the bridge is still disconnected

    // Before connecting: no polling has started.
    expect(sendConsoleSpy).not.toHaveBeenCalled()

    hakkaBridge.connect('ws://localhost:3000')
    // 5ms for the mock socket's onopen, plus one full 1000ms poll tick — the
    // interval only arms on connect, so the first send lands ~1s after that.
    await new Promise((resolve) => setTimeout(resolve, 1050))

    // After connecting: the onStatus subscription armed the interval — this
    // is the assertion that fails without the fix (mount-time-only check).
    expect(sendConsoleSpy).toHaveBeenCalled()

    for (const cleanup of mockEffectCleanups) cleanup?.()
  }, 10000)

  it('useReactQueryDevTools sends the initial snapshot once the bridge connects, even though the hook mounted first', async () => {
    const sendConsoleSpy = jest.spyOn(hakkaBridge, 'sendConsole')
    const query = {
      queryKey: ['me'],
      state: { status: 'success', data: null, error: null, dataUpdatedAt: 0, errorUpdatedAt: 0, fetchStatus: 'idle' },
    }
    const client = {
      getQueryCache: () => ({ getAll: () => [query], subscribe: () => () => {} }),
    } as unknown as Parameters<typeof useReactQueryDevTools>[0]

    mockEffectCleanups.length = 0
    useReactQueryDevTools(client) // mounts while the bridge is still disconnected

    // Before connecting: no snapshot has been sent.
    expect(sendConsoleSpy).not.toHaveBeenCalled()

    hakkaBridge.connect('ws://localhost:3000')
    await new Promise((resolve) => setTimeout(resolve, 5))

    // After connecting: the onStatus subscription armed the cache subscribe
    // and fired the initial sendAllQueries() — fails without the fix.
    expect(sendConsoleSpy).toHaveBeenCalled()

    for (const cleanup of mockEffectCleanups) cleanup?.()
  })
})
