/**
 * NativeCapture.configure() — must not throw on a JS/native version-skewed
 * module (missing `enableNativeWebSocket`), must not throw when the native
 * call itself rejects, and must serialize concurrent
 * `configure({ webSocket: true })` callers onto a single native invocation
 * instead of racing the `captureState.webSocket` check/write. See
 * `src/native/nativeCapture.ts`.
 */

interface NativeCaptureModule {
  NativeCapture: {
    configure: (options: { webSocket?: boolean }) => Promise<void>
    isEnabled: () => { webSocket: boolean }
  }
}

function freshModule(mockNative: Record<string, unknown> | null): NativeCaptureModule {
  jest.resetModules()
  jest.doMock('../NativeHakkaMonitor', () => ({ __esModule: true, default: mockNative }))
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../nativeCapture')
}

describe('NativeCapture.configure', () => {
  it('does not throw when the native module is missing enableNativeWebSocket (version skew)', async () => {
    const { NativeCapture } = freshModule({}) // linked, but predates this method
    await expect(NativeCapture.configure({ webSocket: true })).resolves.toBeUndefined()
    expect(NativeCapture.isEnabled().webSocket).toBe(false)
  })

  it('does not throw when enableNativeWebSocket rejects', async () => {
    const enableNativeWebSocket = jest.fn().mockRejectedValue(new Error('native boom'))
    const { NativeCapture } = freshModule({ enableNativeWebSocket })
    await expect(NativeCapture.configure({ webSocket: true })).resolves.toBeUndefined()
    expect(NativeCapture.isEnabled().webSocket).toBe(false)
  })

  it('serializes concurrent configure({ webSocket: true }) calls onto one native invocation', async () => {
    let resolveEnable!: () => void
    const enableNativeWebSocket = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEnable = resolve
        }),
    )
    const { NativeCapture } = freshModule({ enableNativeWebSocket })

    const first = NativeCapture.configure({ webSocket: true })
    const second = NativeCapture.configure({ webSocket: true })

    expect(enableNativeWebSocket).toHaveBeenCalledTimes(1)
    resolveEnable()
    await Promise.all([first, second])

    expect(enableNativeWebSocket).toHaveBeenCalledTimes(1)
    expect(NativeCapture.isEnabled().webSocket).toBe(true)
  })
})
