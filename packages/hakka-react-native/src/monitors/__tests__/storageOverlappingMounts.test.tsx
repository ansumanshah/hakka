/**
 * useAsyncStorageMonitor — overlapping mounts must not corrupt each other's
 * patch/restore.
 *
 * Each hook instance used to save/restore a raw per-effect closure of
 * AsyncStorage's methods with no shared bookkeeping: a second overlapping
 * mount would capture the *first* mount's already-patched wrapper as its
 * "original", and whichever instance unmounted first would stomp the live
 * AsyncStorage object with whatever it happened to capture — silently
 * breaking the other, still-mounted instance's monitoring. See
 * `src/monitors/storage.ts`.
 */
import React from 'react'
import TestRenderer, { act } from 'react-test-renderer'

import { useAsyncStorageMonitor } from '../storage'

// react-test-renderer's `act()` needs this flag set or every update emits an
// "environment not configured to support act(...)" console warning (same
// setup as Header.test.tsx / useShakeDetection.test.tsx).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mockGetItem = jest.fn(async () => null)
const mockSetItem = jest.fn(async () => undefined)
const mockRemoveItem = jest.fn(async () => undefined)
const mockClear = jest.fn(async () => undefined)

// `@react-native-async-storage/async-storage` is an optional peer dependency
// this workspace doesn't install — mock it virtually, same as `storage.ts`
// resolves it via a bare `require()` at call time. A plain mutable object
// (not a jest.fn-returning factory) so identity comparisons below see the
// same live object `install()`/`uninstall()` patch and restore.
const mockAsyncStorage = {
  getItem: mockGetItem,
  setItem: mockSetItem,
  removeItem: mockRemoveItem,
  clear: mockClear,
}
jest.mock(
  '@react-native-async-storage/async-storage',
  () => ({
    __esModule: true,
    default: mockAsyncStorage,
  }),
  { virtual: true },
)

// Fake `hakkaBridge` so the hook's `onStatus`/`isConnected` can be driven
// directly, without opening a real WebSocket.
jest.mock('../../core/HakkaBridge', () => {
  const listeners = new Set<() => void>()
  let connected = false
  return {
    hakkaBridge: {
      onStatus: (cb: () => void) => {
        listeners.add(cb)
        cb()
        return () => listeners.delete(cb)
      },
      get isConnected() {
        return connected
      },
      sendConsole: jest.fn(),
      __setConnected(next: boolean) {
        connected = next
        for (const cb of listeners) cb()
      },
    },
  }
})

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { hakkaBridge } = require('../../core/HakkaBridge') as { hakkaBridge: { __setConnected: (v: boolean) => void } }

function setConnected(v: boolean): void {
  act(() => {
    hakkaBridge.__setConnected(v)
  })
}

function Harness(): null {
  useAsyncStorageMonitor()
  return null
}

describe('useAsyncStorageMonitor — overlapping mounts', () => {
  const trueGetItem = mockGetItem

  afterEach(() => {
    setConnected(false) // restore, so state doesn't leak into the next test
  })

  it('keeps monitoring active for a still-mounted instance when an earlier-mounted instance unmounts first', () => {
    let rootA: TestRenderer.ReactTestRenderer | null = null
    let rootB: TestRenderer.ReactTestRenderer | null = null

    act(() => {
      rootA = TestRenderer.create(<Harness />)
    })
    act(() => {
      rootB = TestRenderer.create(<Harness />)
    })

    setConnected(true) // both instances install

    expect(mockAsyncStorage.getItem).not.toBe(trueGetItem) // patched

    // A (mounted first) unmounts first — out-of-order relative to B.
    act(() => {
      rootA!.unmount()
    })

    // B is still mounted — monitoring must still be active, not reverted to
    // the true original by A's cleanup.
    expect(mockAsyncStorage.getItem).not.toBe(trueGetItem)

    // B unmounts — now the true original must be restored.
    act(() => {
      rootB!.unmount()
    })
    expect(mockAsyncStorage.getItem).toBe(trueGetItem)
  })
})
