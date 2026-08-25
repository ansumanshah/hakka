import NativeHakkaMonitor from './NativeHakkaMonitor'

interface NativeCaptureOptions {
  /** Enable native WebSocket capture (iOS 13+ only; no-op on Android). Default: false. */
  webSocket?: boolean
}

interface NativeCaptureState {
  webSocket: boolean
}

let captureState: NativeCaptureState = { webSocket: false }

// Serializes concurrent `configure({ webSocket: true })` calls onto a single
// in-flight `enableNativeWebSocket()` invocation — without this, two callers
// that both observe `captureState.webSocket === false` before either write
// would each fire the native call.
let pendingWebSocketEnable: Promise<void> | null = null

async function enableNativeWebSocket(module: NonNullable<typeof NativeHakkaMonitor>): Promise<void> {
  // JS/native version skew: the module is linked but predates this method.
  // Matches the "safe to call multiple times" doc contract below — skip
  // rather than throw.
  if (typeof module.enableNativeWebSocket !== 'function') {
    if (__DEV__)
      console.warn('[Hakka] NativeCapture: native module has no enableNativeWebSocket (version mismatch) — skipping')
    return
  }
  try {
    await module.enableNativeWebSocket()
    captureState = { ...captureState, webSocket: true }
  } catch (err) {
    if (__DEV__) console.warn('[Hakka] NativeCapture: enableNativeWebSocket failed', err)
  }
}

/**
 * Configure and enable native-layer capture features.
 *
 * Call this before (or after) starting the Hakka interceptor. It is safe
 * to call multiple times; settings are applied additively.
 *
 * @example
 * ```ts
 * import { NativeCapture } from 'hakka-react-native'
 *
 * await NativeCapture.configure({ webSocket: true })
 * ```
 */
async function configure(options: NativeCaptureOptions): Promise<void> {
  const module = NativeHakkaMonitor
  if (!module) return

  if (options.webSocket && !captureState.webSocket) {
    if (!pendingWebSocketEnable) {
      pendingWebSocketEnable = enableNativeWebSocket(module).finally(() => {
        pendingWebSocketEnable = null
      })
    }
    await pendingWebSocketEnable
  }
}

/**
 * Returns true if native WebSocket capture has been enabled via [configure].
 */
function isEnabled(): NativeCaptureState {
  return { ...captureState }
}

export const NativeCapture = { configure, isEnabled }
