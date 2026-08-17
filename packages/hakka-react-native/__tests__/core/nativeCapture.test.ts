/**
 * Tests for NativeCapture.
 *
 * The TurboModule is always mocked. We exercise:
 *   1. configure({ webSocket: true }) calls enableNativeWebSocket on the module.
 *   2. configure() is idempotent — does not call native twice within the same instance.
 */

// --- Mock the TurboModule (jest.mock is hoisted) ---
jest.mock('../../src/native/NativeHakkaMonitor', () => ({
  __esModule: true,
  default: {
    enableNativeWebSocket: jest.fn().mockResolvedValue(undefined),
    isNativeCapturing: jest.fn().mockResolvedValue(true),
    initialize: jest.fn().mockResolvedValue(undefined),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  },
}))

import { NativeCapture } from '../../src/native/nativeCapture'
// --- Import after mocks ---
import NativeHakkaMonitorModule from '../../src/native/NativeHakkaMonitor'

// Typed shorthand for the mock
const mockModule = NativeHakkaMonitorModule as {
  enableNativeWebSocket: jest.Mock
  isNativeCapturing: jest.Mock
}

// --- Tests ---

describe('NativeCapture.configure', () => {
  beforeEach(() => {
    mockModule.enableNativeWebSocket.mockClear()
    mockModule.isNativeCapturing.mockClear()
  })

  // These two tests intentionally share the NativeCapture singleton and run in
  // order: the first enables WS capture; the next asserts a second configure() is
  // a no-op (idempotent). jest preserves in-file test order, so this is stable.
  it('calls enableNativeWebSocket on the native module when webSocket: true', async () => {
    await NativeCapture.configure({ webSocket: true })
    expect(mockModule.enableNativeWebSocket).toHaveBeenCalledTimes(1)
  })

  it('does NOT call enableNativeWebSocket again when already enabled', async () => {
    // configure was already called once above; calling again is a no-op.
    await NativeCapture.configure({ webSocket: true })
    expect(mockModule.enableNativeWebSocket).toHaveBeenCalledTimes(0)
  })
})
