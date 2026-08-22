import { configureBodyRedaction } from 'hakka-core'

import { hakkaBridge } from '../../src/core/HakkaBridge'
import { useMMKVMonitor } from '../../src/monitors/storage'

// The monitors are a single `useEffect` each. Running it inline is enough to
// exercise the patching they install, and avoids pulling in a renderer just to
// prove a redaction path is connected. `mock`-prefixed so jest's hoisting of
// `jest.mock` allows the reference.
const mockEffectCleanups: Array<(() => void) | void> = []
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: (effect: () => (() => void) | void) => {
    mockEffectCleanups.push(effect())
  },
}))

/**
 * The redaction helper itself (`redactStorageValue`/`redactStorageEntries`) is
 * covered by `__tests__/storage/redact.test.ts` — it moved to `storage/redact.ts`
 * so `StorageViewer.tsx` and `HakkaBridge.ts` can share it too. These tests prove
 * it is actually WIRED into the path a real monitor operation takes — a fix
 * that isn't connected passes a unit test and still leaks.
 */
describe('MMKV monitor forwards redacted values to the bridge', () => {
  afterEach(() => {
    configureBodyRedaction([])
    jest.restoreAllMocks()
  })

  function drive(key: string, stored: string): unknown {
    const emitted: Array<{ key: string; value: unknown }> = []
    jest.spyOn(hakkaBridge, 'isConnected', 'get').mockReturnValue(true)
    jest.spyOn(hakkaBridge, 'emit').mockImplementation((_type, payload) => {
      emitted.push(payload as { key: string; value: unknown })
    })

    const store: Record<string, string> = { [key]: stored }
    const mmkv = {
      getString: (k: string) => store[k],
      setString: (k: string, v: string) => {
        store[k] = v
      },
      getNumber: () => undefined,
      setNumber: () => {},
      getBoolean: () => undefined,
      setBoolean: () => {},
      delete: () => {},
    }

    mockEffectCleanups.length = 0
    useMMKVMonitor(mmkv)
    mmkv.getString(key)
    for (const cleanup of mockEffectCleanups) cleanup?.()

    return emitted.find((e) => e.key === key)?.value
  }

  it('does not put a stored secret on the wire', () => {
    configureBodyRedaction(['token'])

    expect(drive('auth_token', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('still forwards an ordinary value', () => {
    configureBodyRedaction(['token'])

    expect(drive('theme', 'dark')).toBe('dark')
  })
})
