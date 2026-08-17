import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hakka } from '../../index'
import type { NativeCaptureAdapter, NativeHakkaModule } from '../../index'

/**
 * `Hakka.show()` regression coverage: it must return a boolean the caller can
 * check, not silently no-op when the native module isn't linked — see
 * examples/react-native-example/App.tsx's `showNativeOrWarn`.
 */

function fakeNativeAdapter(
  showUI: NativeHakkaModule['showUI'],
  isUIAvailable?: NativeHakkaModule['isUIAvailable'],
): NativeCaptureAdapter {
  const module: NativeHakkaModule = {
    showUI,
    isUIAvailable,
    clearLogs() {},
    setSensitiveHeaders() {},
    setIgnoredHosts() {},
    setIgnoredPatterns() {},
    initialize: async () => {},
    getLogs: async () => [],
    addListener() {},
    removeListeners() {},
  }
  return {
    getModule: () => module,
    createEventEmitter: () => ({ addListener: () => ({ remove() {} }) }),
  }
}

// `Hakka.stop()` is what clears the facade's cached native-module reference
// (`this.native`) — `registerNativeAdapter(null)` alone only clears the
// *adapter*, so without `stop()` here each test would keep resolving the
// previous test's cached module instead of the fresh one it just registered.
beforeEach(() => {
  Hakka.stop()
  Hakka.registerNativeAdapter(null)
})

afterEach(() => {
  Hakka.stop()
  Hakka.registerNativeAdapter(null)
})

describe('Hakka.show()', () => {
  test('returns false when no native adapter is registered (module not linked)', () => {
    Hakka.registerNativeAdapter(null)
    expect(Hakka.show({ as: 'sheet' })).toBe(false)
  })

  test('returns true and forwards the mode when a native module handles it', () => {
    let receivedMode: string | undefined
    Hakka.registerNativeAdapter(
      fakeNativeAdapter((mode) => {
        receivedMode = mode
      }),
    )

    expect(Hakka.show({ as: 'fullscreen' })).toBe(true)
    expect(receivedMode).toBe('fullscreen')
  })

  test('defaults to "bubble" when no `as` option is given', () => {
    let receivedMode: string | undefined
    Hakka.registerNativeAdapter(
      fakeNativeAdapter((mode) => {
        receivedMode = mode
      }),
    )

    expect(Hakka.show()).toBe(true)
    expect(receivedMode).toBe('bubble')
  })

  test('returns false (not throw) when the native module throws', () => {
    Hakka.registerNativeAdapter(
      fakeNativeAdapter(() => {
        throw new Error('native boom')
      }),
    )

    expect(() => Hakka.show({ as: 'sheet' })).not.toThrow()
    expect(Hakka.show({ as: 'sheet' })).toBe(false)
  })

  // The TurboModule can exist while the optional native UI package (HakkaUI /
  // hakka-ui) isn't linked — native showUI would silently no-op. show() must
  // consult the isUIAvailable() probe and report false without calling showUI.
  test('returns false without calling showUI when isUIAvailable() reports the UI package is not linked', () => {
    let showUICalled = false
    Hakka.registerNativeAdapter(
      fakeNativeAdapter(
        () => {
          showUICalled = true
        },
        () => false,
      ),
    )

    expect(Hakka.show({ as: 'sheet' })).toBe(false)
    expect(showUICalled).toBe(false)
  })

  test('returns true and calls showUI when isUIAvailable() reports the UI package is linked', () => {
    let receivedMode: string | undefined
    Hakka.registerNativeAdapter(
      fakeNativeAdapter(
        (mode) => {
          receivedMode = mode
        },
        () => true,
      ),
    )

    expect(Hakka.show({ as: 'fullscreen' })).toBe(true)
    expect(receivedMode).toBe('fullscreen')
  })
})
