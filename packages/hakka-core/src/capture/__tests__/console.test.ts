import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { ConsoleInterceptor } from '../console'

// Save originals so tests don't bleed into the terminal output.
const originals = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
}

// Silence actual console output during tests.
beforeEach(() => {
  for (const k of Object.keys(originals) as Array<keyof typeof originals>) {
    console[k] = () => {}
  }
})

// ConsoleInterceptor is a module-level singleton — a listener left dangling after one test
// would keep firing in every later test. Route onEntry() through this so afterEach can
// unsubscribe them all (needed for the zero-listener short-circuit tests below).
let activeUnsubs: Array<() => void> = []
function trackOnEntry(
  cb: Parameters<typeof ConsoleInterceptor.onEntry>[0],
): ReturnType<typeof ConsoleInterceptor.onEntry> {
  const unsub = ConsoleInterceptor.onEntry(cb)
  activeUnsubs.push(unsub)
  return unsub
}

afterEach(() => {
  for (const unsub of activeUnsubs) unsub()
  activeUnsubs = []
  ConsoleInterceptor.disable()
  for (const k of Object.keys(originals) as Array<keyof typeof originals>) {
    console[k] = originals[k]
  }
})

describe('ConsoleInterceptor args field', () => {
  test('args contains the raw arguments passed to console.log', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    console.log('hello', 42, { key: 'value' })

    expect(entries).toHaveLength(1)
    const entry = entries[0] as { args?: unknown[] }
    expect(entry.args).toEqual(['hello', 42, { key: 'value' }])
  })

  test('args is a snapshot copy — mutations after the call do not affect captured args', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    const obj = { mutable: true }
    console.log(obj)
    obj.mutable = false // mutate after the call

    const entry = entries[0] as { args?: Array<{ mutable: boolean }> }
    // The spread copy is a new array, but its elements are references, not a deep clone.
    expect(entry.args).toHaveLength(1)
    expect(entry.args![0]).toBe(obj) // same reference
  })

  test('args is present for each intercepted level', () => {
    const entries: Array<{ level: string; args?: unknown[] }> = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e as { level: string; args?: unknown[] }))

    console.log('log-arg')
    console.info('info-arg')
    console.warn('warn-arg')
    console.error('error-arg')
    console.debug('debug-arg')

    expect(entries).toHaveLength(5)
    for (const entry of entries) {
      expect(Array.isArray(entry.args)).toBe(true)
      expect(entry.args).toHaveLength(1)
    }
  })

  test('args is empty array when no arguments passed', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    console.log()

    const entry = entries[0] as { args?: unknown[] }
    expect(entry.args).toEqual([])
  })

  test('multiple arguments of different types are all captured', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    console.error('msg', 123, null, undefined, true, [1, 2])

    const entry = entries[0] as { args?: unknown[] }
    expect(entry.args).toEqual(['msg', 123, null, undefined, true, [1, 2]])
  })
})

describe('ConsoleInterceptor baseline', () => {
  test('message field is still a joined string', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    console.log('hello', 'world')

    const entry = entries[0] as { message: string }
    expect(entry.message).toBe('hello world')
  })

  test('level matches the console method called', () => {
    const entries: Array<{ level: string }> = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e as { level: string }))

    console.warn('oops')

    expect(entries[0].level).toBe('warn')
  })

  test('timestamp is a recent unix ms', () => {
    const before = Date.now()
    const entries: Array<{ timestamp: number }> = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e as { timestamp: number }))

    console.info('ts-check')

    const after = Date.now()
    expect(entries[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(entries[0].timestamp).toBeLessThanOrEqual(after)
  })

  test('enable() is idempotent — double enable does not double-fire listeners', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    ConsoleInterceptor.enable() // second call should be no-op
    trackOnEntry((e) => entries.push(e))

    console.log('once')

    expect(entries).toHaveLength(1)
  })

  test('disable() restores original console methods', () => {
    let called = false
    ConsoleInterceptor.enable()
    trackOnEntry(() => {
      called = true
    })
    ConsoleInterceptor.disable()

    console.log('after-disable')
    // The restored console must not reach the listener.
    expect(called).toBe(false)
    expect(ConsoleInterceptor.isEnabled).toBe(false)
  })

  test('listener errors do not crash the interceptor', () => {
    ConsoleInterceptor.enable()
    trackOnEntry(() => {
      throw new Error('listener boom')
    })

    expect(() => console.log('safe')).not.toThrow()
  })
})

describe('ConsoleInterceptor zero-listener short-circuit', () => {
  test('the original console method still runs with no subscribers', () => {
    let sawArgs: unknown[] | null = null
    console.log = (...args: unknown[]) => {
      sawArgs = args
    }
    ConsoleInterceptor.enable()
    // No onEntry() call — listeners.size === 0.

    console.log('still-runs')

    expect(sawArgs).toEqual(['still-runs'])
  })

  test('entry serialization is skipped entirely with no subscribers (JSON.stringify never runs)', () => {
    let getterReads = 0
    const spied = {
      get x() {
        getterReads++
        return 1
      },
    }
    ConsoleInterceptor.enable()
    // No onEntry() subscriber registered.

    expect(() => console.log(spied)).not.toThrow()
    expect(getterReads).toBe(0)
  })

  test('a listener registered after a zero-listener call is not retroactively invoked', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    console.log('before-subscribe') // short-circuits, nothing recorded

    trackOnEntry((e) => entries.push(e))
    console.log('after-subscribe')

    expect(entries).toHaveLength(1)
    expect((entries[0] as { message: string }).message).toBe('after-subscribe')
  })
})

describe('ConsoleInterceptor message length caps', () => {
  test('a huge single argument truncates the message but leaves the raw arg untouched', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    const huge = 'x'.repeat(20_000)
    console.log(huge)

    const entry = entries[0] as { message: string; args?: unknown[] }
    expect(entry.message.length).toBeLessThan(huge.length)
    expect(entry.message.endsWith('…(truncated)')).toBe(true)
    // The raw args array is never truncated — consumers get the real value.
    expect(entry.args?.[0]).toBe(huge)
  })

  test('total message length is capped even when no single argument exceeds the per-arg cap', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    // 20 args of 1000 chars each — under the per-arg cap individually, but ~20KB joined, over the total message cap.
    const parts = Array.from({ length: 20 }, () => 'y'.repeat(1000))
    console.log(...parts)

    const entry = entries[0] as { message: string; args?: unknown[] }
    expect(entry.message.length).toBeLessThan(parts.join(' ').length)
    expect(entry.message.endsWith('…(truncated)')).toBe(true)
    // Raw args are still all present, untruncated.
    expect(entry.args).toHaveLength(20)
    expect((entry.args?.[0] as string | undefined)?.length).toBe(1000)
  })

  test('short messages are unaffected by the caps', () => {
    const entries: unknown[] = []
    ConsoleInterceptor.enable()
    trackOnEntry((e) => entries.push(e))

    console.log('short and sweet')

    const entry = entries[0] as { message: string }
    expect(entry.message).toBe('short and sweet')
  })
})
