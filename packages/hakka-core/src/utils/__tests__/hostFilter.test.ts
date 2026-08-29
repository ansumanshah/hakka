import { describe, expect, test } from 'bun:test'

import { hostMatchesList, matchesIgnoredPattern, shouldCaptureUrl } from '../hostFilter'

describe('hostMatchesList', () => {
  test('exact match', () => {
    expect(hostMatchesList('example.com', ['example.com'])).toBe(true)
    expect(hostMatchesList('other.com', ['example.com'])).toBe(false)
  })

  test('glob wildcard', () => {
    expect(hostMatchesList('sub.example.com', ['*.example.com'])).toBe(true)
    expect(hostMatchesList('example.com', ['*.example.com'])).toBe(false)
  })

  test('dot-prefix subdomain pattern', () => {
    expect(hostMatchesList('sub.internal.example.com', ['.internal.example.com'])).toBe(true)
    expect(hostMatchesList('internal.example.com', ['.internal.example.com'])).toBe(true)
    expect(hostMatchesList('other.com', ['.internal.example.com'])).toBe(false)
  })

  test('regex literal pattern', () => {
    expect(hostMatchesList('analytics.example.com', ['/analytics/'])).toBe(true)
    expect(hostMatchesList('other.com', ['/analytics/'])).toBe(false)
  })

  test('case-insensitive matching', () => {
    expect(hostMatchesList('EXAMPLE.COM', ['example.com'])).toBe(true)
    expect(hostMatchesList('Example.COM', ['*.example.com'])).toBe(false)
  })

  test('glob pattern matches consistently across repeated calls (compiled-glob cache does not corrupt results)', () => {
    const pattern = '*.cached-glob-test.com'
    expect(hostMatchesList('sub.cached-glob-test.com', [pattern])).toBe(true)
    expect(hostMatchesList('sub.cached-glob-test.com', [pattern])).toBe(true) // second call — hits the cache
    expect(hostMatchesList('cached-glob-test.com', [pattern])).toBe(false)
    expect(hostMatchesList('other.com', [pattern])).toBe(false)
  })

  test('distinct glob patterns each compile and cache to their own RegExp (no cross-contamination)', () => {
    expect(hostMatchesList('a.foo.com', ['*.foo.com'])).toBe(true)
    expect(hostMatchesList('a.bar.com', ['*.bar.com'])).toBe(true)
    expect(hostMatchesList('a.bar.com', ['*.foo.com'])).toBe(false)
    expect(hostMatchesList('a.foo.com', ['*.bar.com'])).toBe(false)
  })
})

describe('shouldCaptureUrl', () => {
  test('blacklist mode blocks listed hosts', () => {
    expect(shouldCaptureUrl('https://blocked.com/path', { mode: 'blacklist', hosts: ['blocked.com'] })).toBe(false)
    expect(shouldCaptureUrl('https://allowed.com/path', { mode: 'blacklist', hosts: ['blocked.com'] })).toBe(true)
  })

  test('whitelist mode only allows listed hosts', () => {
    expect(shouldCaptureUrl('https://allowed.com/path', { mode: 'whitelist', hosts: ['allowed.com'] })).toBe(true)
    expect(shouldCaptureUrl('https://other.com/path', { mode: 'whitelist', hosts: ['allowed.com'] })).toBe(false)
  })
})

describe('matchesIgnoredPattern', () => {
  test('plain string substring match', () => {
    expect(matchesIgnoredPattern('https://api.example.com/health', ['health'])).toBe(true)
    expect(matchesIgnoredPattern('https://api.example.com/users', ['health'])).toBe(false)
  })

  test('glob pattern matching full URL with trailing wildcard', () => {
    expect(matchesIgnoredPattern('https://foo.analytics.com/track', ['*analytics.com*'])).toBe(true)
    expect(matchesIgnoredPattern('https://example.com/track', ['*analytics.com*'])).toBe(false)
  })

  test('regex literal pattern', () => {
    expect(matchesIgnoredPattern('https://example.com/api/v1/health', ['/\\/health$/'])).toBe(true)
    expect(matchesIgnoredPattern('https://example.com/api/v1/users', ['/\\/health$/'])).toBe(false)
  })

  test('benign glob patterns still match correctly after memoization', () => {
    const pattern = '*analytics.com*'
    // Call multiple times to exercise memoization path
    expect(matchesIgnoredPattern('https://foo.analytics.com/t', [pattern])).toBe(true)
    expect(matchesIgnoredPattern('https://foo.analytics.com/t', [pattern])).toBe(true)
    expect(matchesIgnoredPattern('https://example.com/t', [pattern])).toBe(false)
  })

  // Budget note: the two outcomes here are orders of magnitude apart, not close
  // together. With input bounding this returns in about 5ms; WITHOUT it,
  // `(a+)+$` against 30 a's is ~2^30 backtracks, which is effectively forever,
  // not "a bit slow". So the threshold only has to sit somewhere in that gulf.
  //
  // It used to be 5000ms, with bun's default per-test timeout also at 5000ms,
  // which left no headroom at all: on a loaded machine (the parallel `just
  // verify` gate) this measured 5357ms and failed, reporting a ReDoS
  // regression that did not exist. A wall-clock assertion that can only be
  // tripped by CPU contention is worse than none, because it teaches you to
  // ignore the gate. Widened to 30s, with the test timeout raised past it, so
  // the only thing that can fail this is genuine catastrophic backtracking.
  const REDOS_BUDGET_MS = 30_000

  test(
    'completes within reasonable time for a potentially expensive pattern (ReDoS mitigation)',
    () => {
      // Pattern with nested quantifiers — would be catastrophic without input bounding
      const pattern = '(a+)+$'
      const longInput = 'a'.repeat(30) + 'b'
      const start = Date.now()
      matchesIgnoredPattern(longInput, [pattern])
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(REDOS_BUDGET_MS)
    },
    REDOS_BUDGET_MS + 5_000,
  )

  test('returns false when patterns array is empty', () => {
    expect(matchesIgnoredPattern('https://example.com', [])).toBe(false)
  })

  test('the same glob pattern string compiles consistently whether used as a host pattern or a URL pattern', () => {
    // hostMatchesList and matchesIgnoredPattern share the compiled-glob cache (namespaced under `__glob__<pattern>`), so both must read back the same compiled RegExp for a given string.
    const pattern = '*.shared-glob-cache-test.com'
    expect(hostMatchesList('a.shared-glob-cache-test.com', [pattern])).toBe(true)
    expect(matchesIgnoredPattern('a.shared-glob-cache-test.com', [pattern])).toBe(true)
    expect(matchesIgnoredPattern('https://a.shared-glob-cache-test.com/path', [pattern])).toBe(false)
  })
})
