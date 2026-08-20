import { configureBodyRedaction } from 'hakka-core'

import { hakkaBridge } from '../../src/core/HakkaBridge'
import { redactStorageValue, useMMKVMonitor } from '../../src/monitors/storage'

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
 * The storage monitors forward every AsyncStorage/MMKV read and write to the
 * desktop app. They did so verbatim — and storage is where auth tokens and
 * credentials are *persisted*, not merely where they transit, so this was the
 * worst instance of the redaction gap already closed on the capture paths.
 */
describe('storage value redaction', () => {
  afterEach(() => configureBodyRedaction([]))

  it('passes values through untouched when nothing is configured', () => {
    expect(redactStorageValue('auth_token', 'sk-live-abc')).toBe('sk-live-abc')
  })

  it('blanks a value whose key names a sensitive field', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('token', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('matches a namespaced key by substring, since real keys are namespaced', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('@myapp:auth_token', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('is case-insensitive on the key', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('AUTH_TOKEN', 'sk-live-abc')).toBe('[REDACTED]')
  })

  it('leaves an unrelated key alone', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('theme', 'dark')).toBe('dark')
  })

  it('redacts sensitive fields inside a stored JSON blob', () => {
    configureBodyRedaction(['password'])

    const stored = JSON.stringify({ user: 'ada', password: 'hunter2' })
    const result = redactStorageValue('session', stored) as string

    expect(result).not.toContain('hunter2')
    expect(result).toContain('ada')
  })

  it('leaves a non-JSON string alone when the key is not sensitive', () => {
    configureBodyRedaction(['password'])

    expect(redactStorageValue('greeting', 'hello world')).toBe('hello world')
  })

  it('passes null and undefined through', () => {
    configureBodyRedaction(['token'])

    expect(redactStorageValue('token', null)).toBeNull()
    expect(redactStorageValue('token', undefined)).toBeUndefined()
  })

  it('does not stringify a non-string value it cannot inspect', () => {
    configureBodyRedaction(['password'])

    expect(redactStorageValue('count', 42)).toBe(42)
  })
})

/**
 * The tests above exercise the helper. These prove it is actually WIRED into
 * the path a real operation takes — a fix that isn't connected passes a unit
 * test and still leaks.
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
