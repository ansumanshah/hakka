/**
 * HakkaBridge `storage:set` allowlist — `MAX_VALUE_BYTES` must cap encoded
 * UTF-8 bytes, not the JS string's UTF-16 `.length` (see `isAllowedValue` in
 * `HakkaBridge.ts`). A non-ASCII-heavy value that sits under the `.length`
 * cap but over the byte cap must be rejected, not silently forwarded to
 * AsyncStorage.
 */
import { HakkaBridge } from '../HakkaBridge'

// Reach the private message handler without opening a real socket — same
// approach as `bridgeControl.test.ts`.
type MessageCapable = { _handleMessage(event: { data?: unknown }): void }

const frame = (type: string, payload: unknown): { data: string } => ({ data: JSON.stringify({ type, payload }) })

const mockSetItem = jest.fn().mockResolvedValue(undefined)

// `@react-native-async-storage/async-storage` is an optional peer dependency
// this workspace doesn't install — mock it virtually, same as the module
// under test resolves it via a bare `require()` at call time.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => ({
    __esModule: true,
    default: { setItem: mockSetItem },
  }),
  { virtual: true },
)

describe('HakkaBridge — storage:set byte-length allowlist', () => {
  const bridge = new HakkaBridge() as unknown as MessageCapable

  beforeEach(() => {
    mockSetItem.mockClear()
  })

  it('rejects a value under the UTF-16 .length cap but over the UTF-8 byte cap', () => {
    // 64 * 1024 three-byte-in-UTF-8 characters: `.length` is 65536 (right at
    // the old, buggy limit) but the encoded size is 196608 bytes — well past
    // MAX_VALUE_BYTES (64 * 1024).
    const oversized = 'あ'.repeat(64 * 1024)
    bridge._handleMessage(frame('storage:set', { key: 'hakka:test', value: oversized }))
    expect(mockSetItem).not.toHaveBeenCalled()
  })

  it('allows a value within the byte cap', () => {
    const ok = 'x'.repeat(1000)
    bridge._handleMessage(frame('storage:set', { key: 'hakka:test', value: ok }))
    expect(mockSetItem).toHaveBeenCalledWith('hakka:test', ok)
  })
})
