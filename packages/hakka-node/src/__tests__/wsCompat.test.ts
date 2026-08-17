import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

/**
 * Regression coverage for the "zero frames reach the hub" bug: some
 * bundler-based Node build layers stub the missing `bufferutil` native addon
 * to an empty module (`{}`) rather than letting `require()` throw, so `ws`'s
 * own fallback-detection never engages and every `ws.send()` throws
 * `bufferUtil.mask is not a function` — silently swallowed by the bridge
 * client's queue/retry logic.
 *
 * The fix is `WS_NO_BUFFER_UTIL`, which must be set before `ws` first
 * evaluates its `buffer-util.js` (the module that probes for the native
 * addon). These tests assert the env-var contract; they cannot exercise the
 * actual bundling failure (that requires a real bundler pass).
 */
describe('wsCompat', () => {
  const ORIGINAL = process.env.WS_NO_BUFFER_UTIL

  beforeEach(() => {
    delete process.env.WS_NO_BUFFER_UTIL
  })

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.WS_NO_BUFFER_UTIL
    else process.env.WS_NO_BUFFER_UTIL = ORIGINAL
  })

  test('importing the module sets WS_NO_BUFFER_UTIL', async () => {
    expect(process.env.WS_NO_BUFFER_UTIL).toBeUndefined()
    // Bust bun's module cache so the side effect actually re-runs.
    await import(`../wsCompat?t=${Date.now()}`)
    expect(process.env.WS_NO_BUFFER_UTIL).toBe('1')
  })

  test('does not clobber an explicit "0" set by the host app', async () => {
    process.env.WS_NO_BUFFER_UTIL = '0'
    await import(`../wsCompat?t=${Date.now()}-b`)
    expect(process.env.WS_NO_BUFFER_UTIL).toBe('0')
  })

  test('bridgeClient imports wsCompat before ws', async () => {
    // Static-analysis-style guard: the module that statically `import`s 'ws'
    // must import './wsCompat' first, so ESM's declaration-order module
    // evaluation runs the env-var side effect before ws's own module body.
    const bridgeClientSrc = await Bun.file(new URL('../bridgeClient.ts', import.meta.url)).text()
    const wsImportIdx = bridgeClientSrc.indexOf("from 'ws'")
    const compatImportIdx = bridgeClientSrc.indexOf("import './wsCompat'")
    expect(compatImportIdx).toBeGreaterThanOrEqual(0)
    expect(compatImportIdx).toBeLessThan(wsImportIdx)
  })
})
