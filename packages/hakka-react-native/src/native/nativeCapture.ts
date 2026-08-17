import NativeHakkaMonitor from './NativeHakkaMonitor'

interface NativeCaptureOptions {
  /** Enable native WebSocket capture (iOS 13+ only; no-op on Android). Default: false. */
  webSocket?: boolean
}

interface NativeCaptureState {
  webSocket: boolean
}

let captureState: NativeCaptureState = { webSocket: false }

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
    await module.enableNativeWebSocket()
    captureState = { ...captureState, webSocket: true }
  }
}

/**
 * Returns true if native WebSocket capture has been enabled via [configure].
 */
function isEnabled(): NativeCaptureState {
  return { ...captureState }
}

export const NativeCapture = { configure, isEnabled }
