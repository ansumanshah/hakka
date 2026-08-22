import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hakka } from '../../index'
import type { NativeCaptureAdapter, NativeHakkaModule, StorageSnapshot } from '../../index'
import { logStore } from '../../log/LogStore'
import { NATIVE_CONSOLE_EVENT, NATIVE_STORAGE_EVENT, NATIVE_REQUEST_EVENT } from '../nativeProtocol'

/**
 * `NATIVE_CONSOLE_EVENT`/`NATIVE_STORAGE_EVENT` — the native->JS relay for structured log
 * entries and device-storage snapshots produced natively (Android's `Hakka.log`/
 * `HakkaTimberTree` and on-demand SharedPreferences capture), which never had a JS-side path
 * before. Mirrors `NATIVE_REQUEST_EVENT`'s subscription in `startNativeCapture`, but console
 * entries land in the shared `logStore` (so `HakkaBridge`'s existing `logStore.subscribe`
 * relays them for free) while storage snapshots dispatch to `Hakka.onNativeStorage` listeners
 * (there is no shared "storage store" to funnel into).
 */

type FakeEmitter = {
  adapter: NativeCaptureAdapter
  module: NativeHakkaModule & { publishStorageSnapshots: ReturnType<typeof fn> }
  fire: (event: string, payload: unknown) => void
  removedEvents: string[]
}

// Minimal jest-less spy — bun:test doesn't ship `jest.fn()` on this import path.
function fn<T extends (...args: never[]) => unknown>(impl?: T) {
  const calls: unknown[][] = []
  const wrapped = ((...args: never[]) => {
    calls.push(args)
    return impl?.(...args)
  }) as T & { calls: unknown[][] }
  wrapped.calls = calls
  return wrapped
}

function fakeNativeWithEmitter(): FakeEmitter {
  const listeners = new Map<string, (payload: unknown) => void>()
  const removedEvents: string[] = []
  const module = {
    showUI() {},
    clearLogs() {},
    setSensitiveHeaders() {},
    setIgnoredHosts() {},
    setIgnoredPatterns() {},
    initialize: async () => {},
    getLogs: async () => [],
    addListener() {},
    removeListeners() {},
    publishStorageSnapshots: fn(),
  }
  const adapter: NativeCaptureAdapter = {
    getModule: () => module,
    createEventEmitter: () => ({
      addListener: (event: string, cb: (payload: unknown) => void) => {
        listeners.set(event, cb)
        return {
          remove: () => {
            listeners.delete(event)
            removedEvents.push(event)
          },
        }
      },
    }),
  }
  return {
    adapter,
    module,
    fire: (event, payload) => listeners.get(event)?.(payload),
    removedEvents,
  }
}

// `logStore` is a process-wide singleton (`hakka-core`'s shared structured-log ring
// buffer, also touched by `log/__tests__/logApi.test.ts`) — clear it on both sides so
// this file's assertions never depend on what ran immediately before it.
beforeEach(() => {
  logStore.clear()
})

afterEach(() => {
  Hakka.stop()
  Hakka.registerNativeAdapter(null)
  Hakka.clearLogs()
  logStore.clear()
})

describe('native console relay', () => {
  test('an onHakkaConsole event adds the parsed entry to the shared logStore', () => {
    const { adapter, fire } = fakeNativeWithEmitter()
    Hakka.registerNativeAdapter(adapter)
    Hakka.start({ mode: 'native' })

    fire(NATIVE_CONSOLE_EVENT, [{ id: 'log_1', timestamp: 1_700_000_000_000, level: 'info', message: 'app launched' }])

    const entries = logStore.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual({ id: 'log_1', timestamp: 1_700_000_000_000, level: 'info', message: 'app launched' })
  })

  test('a malformed onHakkaConsole payload (missing message) is dropped, not crashed on', () => {
    const { adapter, fire } = fakeNativeWithEmitter()
    Hakka.registerNativeAdapter(adapter)
    Hakka.start({ mode: 'native' })

    fire(NATIVE_CONSOLE_EVENT, [{ id: 'log_1', timestamp: 1, level: 'info' }])

    expect(logStore.getEntries()).toHaveLength(0)
  })
})

describe('native storage relay', () => {
  test('an onHakkaStorage event dispatches the parsed snapshot to onNativeStorage listeners', () => {
    const { adapter, fire } = fakeNativeWithEmitter()
    Hakka.registerNativeAdapter(adapter)
    Hakka.start({ mode: 'native' })

    const received: StorageSnapshot[] = []
    const unsubscribe = Hakka.onNativeStorage((snapshot) => received.push(snapshot))

    fire(NATIVE_STORAGE_EVENT, [{ store: 'sharedPreferences:auth', timestamp: 5, entries: { userId: 'u_1' } }])

    expect(received).toEqual([{ store: 'sharedPreferences:auth', timestamp: 5, entries: { userId: 'u_1' } }])
    unsubscribe()
  })

  test('onNativeStorage unsubscribe stops further delivery', () => {
    const { adapter, fire } = fakeNativeWithEmitter()
    Hakka.registerNativeAdapter(adapter)
    Hakka.start({ mode: 'native' })

    const received: StorageSnapshot[] = []
    const unsubscribe = Hakka.onNativeStorage((snapshot) => received.push(snapshot))
    unsubscribe()

    fire(NATIVE_STORAGE_EVENT, [{ store: 'a', timestamp: 1, entries: {} }])

    expect(received).toHaveLength(0)
  })

  test('requestNativeStorageSnapshots() calls the native module method', () => {
    const { adapter, module } = fakeNativeWithEmitter()
    Hakka.registerNativeAdapter(adapter)
    Hakka.start({ mode: 'native' })

    Hakka.requestNativeStorageSnapshots()

    expect(module.publishStorageSnapshots.calls.length).toBe(1)
  })

  test('requestNativeStorageSnapshots() is a no-op with no active native module', () => {
    expect(() => Hakka.requestNativeStorageSnapshots()).not.toThrow()
  })
})

describe('native event subscription lifecycle', () => {
  test('stop() tears down all three native subscriptions (request, console, storage)', () => {
    const { adapter, removedEvents } = fakeNativeWithEmitter()
    Hakka.registerNativeAdapter(adapter)
    Hakka.start({ mode: 'native' })
    Hakka.stop()

    expect(removedEvents.sort()).toEqual([NATIVE_CONSOLE_EVENT, NATIVE_REQUEST_EVENT, NATIVE_STORAGE_EVENT].sort())
  })
})
