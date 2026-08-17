import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

/**
 * Same `WS_NO_BUFFER_UTIL` requirement as `hakka-node`'s client bridge (see
 * `packages/hakka-node/src/wsCompat.test.ts`), here for `hakka-bridge`'s
 * `server.ts` — used directly by `hakka-node`'s embedded-hub path, and
 * standalone by anyone embedding the bridge server in a bundler context.
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
    await import(`../wsCompat?t=${Date.now()}`)
    expect(process.env.WS_NO_BUFFER_UTIL).toBe('1')
  })

  test('server.ts imports wsCompat before ws', async () => {
    const serverSrc = await Bun.file(new URL('../server.ts', import.meta.url)).text()
    const wsImportIdx = serverSrc.indexOf("from 'ws'")
    const compatImportIdx = serverSrc.indexOf("import './wsCompat'")
    expect(compatImportIdx).toBeGreaterThanOrEqual(0)
    expect(compatImportIdx).toBeLessThan(wsImportIdx)
  })
})
