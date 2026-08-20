import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Proves the RuleEngine contract (ADR 0003) added ZERO coupling to the
 * interceptor hot path. The wrappers are additive — `capture/fetch.ts` and
 * `capture/xhr.ts` must keep calling `mockEngine`/`ThrottleEngine`/
 * `breakpointEngine` directly, exactly as before this contract existed. If a
 * future change makes either interceptor import `contract/ruleEngine` (or
 * dispatch through the `RuleEngine` interface), that is precisely the
 * hot-path regression ADR 0003's "no per-record dynamic dispatch on hot
 * paths" condition forbids — this test exists to catch it landing silently.
 */

const captureDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'capture')

function readCaptureFile(name: string): string {
  return readFileSync(join(captureDir, name), 'utf-8')
}

describe('RuleEngine contract does not touch the interceptor hot path', () => {
  test('capture/fetch.ts does not reference the RuleEngine contract', () => {
    const source = readCaptureFile('fetch.ts')
    expect(source).not.toMatch(/contract\/ruleEngine/)
    expect(source).not.toMatch(/RuleEngine/)
  })

  test('capture/xhr.ts does not reference the RuleEngine contract', () => {
    const source = readCaptureFile('xhr.ts')
    expect(source).not.toMatch(/contract\/ruleEngine/)
    expect(source).not.toMatch(/RuleEngine/)
  })

  test('capture/fetch.ts still imports the concrete engine singletons directly', () => {
    const source = readCaptureFile('fetch.ts')
    expect(source).toMatch(/from '..\/engine\/MockEngine'/)
    expect(source).toMatch(/from '..\/engine\/ThrottleEngine'/)
    expect(source).toMatch(/from '..\/engine\/BreakpointEngine'/)
  })
})
