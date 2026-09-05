import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Hakka } from '../../index'
import type { NativeCaptureAdapter, NativeHakkaModule } from '../../index'

/**
 * `Hakka.show()` regression coverage: it must resolve to a boolean the caller can
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
  Hakka.configure({ mode: 'auto', enabled: true })
})

afterEach(() => {
  Hakka.stop()
  Hakka.registerNativeAdapter(null)
  Hakka.configure({ mode: 'auto', enabled: true })
})

describe('Hakka.show()', () => {
  test('returns false when no native adapter is registered (module not linked)', async () => {
    Hakka.registerNativeAdapter(null)
    // Start headlessly, then select native mode without installing browser interceptors.
    Hakka.start({ mode: 'store' })
    Hakka.configure({ mode: 'native' })
    expect(await Hakka.show({ as: 'sheet' })).toBe(false)
  })

  test('returns true and forwards the mode when a native module handles it', async () => {
    let receivedMode: string | undefined
    Hakka.registerNativeAdapter(
      fakeNativeAdapter((mode) => {
        receivedMode = mode
        return true
      }),
    )

    Hakka.start()
    expect(await Hakka.show({ as: 'fullscreen' })).toBe(true)
    expect(receivedMode).toBe('fullscreen')
  })

  test('defaults to "bubble" when no `as` option is given', async () => {
    let receivedMode: string | undefined
    Hakka.registerNativeAdapter(
      fakeNativeAdapter((mode) => {
        receivedMode = mode
        return true
      }),
    )

    Hakka.start()
    expect(await Hakka.show()).toBe(true)
    expect(receivedMode).toBe('bubble')
  })

  test('returns false (not throw) when the native module throws', async () => {
    Hakka.registerNativeAdapter(
      fakeNativeAdapter(() => {
        throw new Error('native boom')
      }),
    )

    Hakka.start()
    expect(await Hakka.show({ as: 'sheet' })).toBe(false)
  })

  // The TurboModule can exist while the optional native UI package (HakkaUI /
  // hakka-ui) isn't linked — native showUI would silently no-op. show() must
  // consult the isUIAvailable() probe and report false without calling showUI.
  test('returns false without calling showUI when isUIAvailable() reports the UI package is not linked', async () => {
    let showUICalled = false
    Hakka.registerNativeAdapter(
      fakeNativeAdapter(
        () => {
          showUICalled = true
        },
        () => false,
      ),
    )

    Hakka.start()
    expect(await Hakka.show({ as: 'sheet' })).toBe(false)
    expect(showUICalled).toBe(false)
  })

  test('returns true and calls showUI when isUIAvailable() reports the UI package is linked', async () => {
    let receivedMode: string | undefined
    Hakka.registerNativeAdapter(
      fakeNativeAdapter(
        (mode) => {
          receivedMode = mode
          return true
        },
        () => true,
      ),
    )

    Hakka.start()
    expect(await Hakka.show({ as: 'fullscreen' })).toBe(true)
    expect(receivedMode).toBe('fullscreen')
  })
})

test('waits for native presentation to finish', async () => {
  let finish!: (shown: boolean) => void
  let started!: () => void
  const nativeCalled = new Promise<void>((resolve) => {
    started = resolve
  })
  Hakka.registerNativeAdapter(
    fakeNativeAdapter(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve
          started()
        }),
    ),
  )
  Hakka.start()
  let settled = false
  const presentation = Hakka.show().then((shown) => {
    settled = true
    return shown
  })
  await nativeCalled
  expect(settled).toBe(false)
  finish(true)
  expect(await presentation).toBe(true)
})

test('returns false when native presentation fails asynchronously', async () => {
  Hakka.registerNativeAdapter(
    fakeNativeAdapter(async () => {
      throw new Error('No active scene')
    }),
  )
  Hakka.start()
  expect(await Hakka.show()).toBe(false)
})

test('does not claim success for legacy native modules without a result', async () => {
  Hakka.registerNativeAdapter(fakeNativeAdapter(() => {}))
  Hakka.start()
  expect(await Hakka.show()).toBe(false)
})

test('does not open a separate native inspector for a JS store', async () => {
  let called = false
  Hakka.registerNativeAdapter(
    fakeNativeAdapter(async () => {
      called = true
      return true
    }),
  )
  Hakka.start({ mode: 'store' })
  expect(await Hakka.show()).toBe(false)
  expect(called).toBe(false)
})

test('waits for capture initialization and cancels presentation after stop', async () => {
  let initialize!: () => void
  let presented = false
  const adapter = fakeNativeAdapter(async () => {
    presented = true
    return true
  })
  adapter.getModule()!.initialize = () =>
    new Promise<void>((resolve) => {
      initialize = resolve
    })
  Hakka.registerNativeAdapter(adapter)
  Hakka.start()
  const presentation = Hakka.show()
  await Promise.resolve()
  expect(presented).toBe(false)
  Hakka.stop()
  initialize()
  expect(await presentation).toBe(false)
  expect(presented).toBe(false)
})

test('hide cancels an inspector waiting for native initialization', async () => {
  let initialize!: () => void
  let presented = false
  const adapter = fakeNativeAdapter(async () => {
    presented = true
    return true
  })
  adapter.getModule()!.initialize = () =>
    new Promise<void>((resolve) => {
      initialize = resolve
    })
  adapter.getModule()!.hideUI = () => {}
  Hakka.registerNativeAdapter(adapter)
  Hakka.start()
  const presentation = Hakka.show()
  Hakka.hide()
  initialize()
  expect(await presentation).toBe(false)
  expect(presented).toBe(false)
})
