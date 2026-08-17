import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { startHakkaClient } from '../client'

/**
 * The one thing genuinely hard to unit-test here — Turbopack/webpack literal-
 * specifier resolution and chunk splitting — is verified separately against a
 * real Next.js app, not reproducible in a `bun test` process. What IS
 * reproducible here, deterministically and fast: `startHakkaClient`'s settle-
 * timeout logic. `startHakkaClient` takes an optional second, internal-only
 * loader parameter (default: the real `import('hakka-browser')`) precisely so
 * these cases don't need real dynamic-import/module-mocking machinery — the
 * audit finding that motivated the timeout was an import promise that never
 * settles at all (not even rejects), which is trivial to construct directly
 * as `new Promise(() => {})` and impossible to await for a result.
 */

let warn: ReturnType<typeof mock>
let originalWarn: typeof console.warn

beforeEach(() => {
  // `startHakkaClient` no-ops without a `window` — this is browser-only code.
  ;(globalThis as { window?: unknown }).window = globalThis
  warn = mock(() => {})
  originalWarn = console.warn
  console.warn = warn as unknown as typeof console.warn
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  console.warn = originalWarn
})

async function flush(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

describe('startHakkaClient — settle timeout', () => {
  test('starts the overlay and never warns when the loader resolves quickly', async () => {
    const start = mock(() => {})
    const connect = mock(() => {})
    startHakkaClient({ settleTimeoutMs: 30 }, () => Promise.resolve({ start, connect }))
    await flush(80)

    expect(start).toHaveBeenCalledTimes(1)
    expect(connect).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  test('default ignorePatterns cover both webpack and Turbopack HMR endpoints', async () => {
    const start = mock(() => {})
    startHakkaClient({ settleTimeoutMs: 30 }, () => Promise.resolve({ start, connect: mock(() => {}) }))
    await flush(80)

    const [opts] = start.mock.calls[0] as [{ ignorePatterns: string[] }]
    expect(opts.ignorePatterns).toContain('*_next/webpack-hmr*')
    expect(opts.ignorePatterns).toContain('*_next/hmr*') // Turbopack, the Next 16 default
  })

  test('warns once the loader promise never settles within settleTimeoutMs', async () => {
    // Reproduces the audit's finding A shape at the promise level: an
    // `import()` that neither resolves nor rejects, ever.
    startHakkaClient({ settleTimeoutMs: 30 }, () => new Promise(() => {}))
    await flush(80)

    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message).toContain('[hakka] overlay not started')
    expect(message).toContain('still loading')
    expect(message).toContain('overlay-pattern-prefer-a-client-component-over-instrumentation-clientts')
  })

  test('does not warn if the loader settles (even late) before the deadline', async () => {
    const start = mock(() => {})
    const connect = mock(() => {})
    startHakkaClient(
      { settleTimeoutMs: 200 },
      () => new Promise((resolve) => setTimeout(() => resolve({ start, connect }), 20)),
    )
    await flush(80)

    expect(start).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  test('does not warn a second time once the loader eventually settles after the deadline', async () => {
    // The settle-timeout warning already fired at 20ms; a late resolution at
    // 60ms must not ALSO retrigger it or log anything extra — the timer
    // already fired once and is inert afterwards.
    const start = mock(() => {})
    const connect = mock(() => {})
    startHakkaClient(
      { settleTimeoutMs: 20 },
      () => new Promise((resolve) => setTimeout(() => resolve({ start, connect }), 60)),
    )
    await flush(100)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('rejection before the deadline logs only the existing rejection warning, not the timeout one', async () => {
    startHakkaClient({ settleTimeoutMs: 200 }, () => Promise.reject(new Error('boom')))
    await flush(80)

    expect(warn).toHaveBeenCalledTimes(1)
    const [message] = warn.mock.calls[0] as [string]
    expect(message).toContain('hakka-browser failed to load')
    expect(message).not.toContain('still loading')
  })

  test('settleTimeoutMs: Infinity disables the backstop warning entirely', async () => {
    startHakkaClient({ settleTimeoutMs: Infinity }, () => new Promise(() => {}))
    await flush(80)

    expect(warn).not.toHaveBeenCalled()
  })

  test('production mode skips both the load and the warning', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const loader = mock(() => new Promise<never>(() => {}))
      startHakkaClient({ settleTimeoutMs: 10 }, loader)
      await flush(50)

      expect(loader).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })
})
