import { configureBodyRedaction } from 'hakka-core'

import { hakkaBridge } from '../../src/core/HakkaBridge'
import { redactQueryData, useQueryMonitor } from '../../src/monitors/reactQuery'

// Run effects inline rather than pulling in a renderer — the hook body is a
// single `useEffect`. `mock`-prefixed so jest's hoisting allows the reference.
const mockEffectCleanups: Array<(() => void) | void> = []
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: (effect: () => (() => void) | void) => {
    mockEffectCleanups.push(effect())
  },
}))

/**
 * A react-query cache holds whole API responses, so it carries exactly what the
 * network interceptors already redact — but this monitor emitted the parsed
 * object on its own channel, bypassing all of it.
 */
describe('query data redaction', () => {
  afterEach(() => configureBodyRedaction([]))

  it('passes data through untouched when nothing is configured', () => {
    const data = { user: 'ada', token: 'sk-live-abc' }

    expect(redactQueryData(data)).toEqual(data)
  })

  it('redacts a configured field', () => {
    configureBodyRedaction(['token'])

    expect(redactQueryData({ user: 'ada', token: 'sk-live-abc' })).toEqual({
      user: 'ada',
      token: '[REDACTED]',
    })
  })

  it('redacts nested and array-nested fields', () => {
    configureBodyRedaction(['password'])

    const result = redactQueryData({ users: [{ name: 'ada', password: 'hunter2' }] })

    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(JSON.stringify(result)).toContain('ada')
  })

  it('passes null and undefined through', () => {
    configureBodyRedaction(['token'])

    expect(redactQueryData(null)).toBeNull()
    expect(redactQueryData(undefined)).toBeUndefined()
  })

  it('drops an unserializable payload rather than emitting it unredacted', () => {
    configureBodyRedaction(['token'])
    const cyclic: Record<string, unknown> = { token: 'sk-live-abc' }
    cyclic.self = cyclic

    expect(redactQueryData(cyclic)).toBeUndefined()
  })

  it('leaves a primitive alone', () => {
    configureBodyRedaction(['token'])

    expect(redactQueryData(42)).toBe(42)
  })
})

/**
 * The tests above exercise the helper. This one proves it is WIRED into the
 * emit path — with only helper tests, removing the wiring left them all green.
 */
describe('query monitor forwards redacted data to the bridge', () => {
  afterEach(() => {
    configureBodyRedaction([])
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('does not put a cached secret on the wire', () => {
    jest.useFakeTimers()
    configureBodyRedaction(['token'])

    const emitted: Array<{ data?: unknown }> = []
    jest.spyOn(hakkaBridge, 'isConnected', 'get').mockReturnValue(true)
    jest.spyOn(hakkaBridge, 'emit').mockImplementation((_type, payload) => {
      emitted.push(payload as { data?: unknown })
    })

    const client = {
      getQueryState: () => ({
        status: 'success',
        data: { user: 'ada', token: 'sk-live-abc' },
        error: null,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        fetchStatus: 'idle',
      }),
      getQueryCache: () => ({ subscribe: () => () => {}, getAll: () => [] }),
    } as unknown as Parameters<typeof useQueryMonitor>[1]

    mockEffectCleanups.length = 0
    useQueryMonitor([['me']], client)
    jest.advanceTimersByTime(5000)
    for (const cleanup of mockEffectCleanups) cleanup?.()

    expect(emitted.length).toBeGreaterThan(0)
    expect(JSON.stringify(emitted)).not.toContain('sk-live-abc')
    expect(JSON.stringify(emitted)).toContain('ada')
  })
})
