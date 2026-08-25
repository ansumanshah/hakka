import { describe, expect, test } from 'bun:test'

import { globToUrlRegExp } from '../urlGlob'

describe('globToUrlRegExp', () => {
  test('* expands to match any run of characters', () => {
    const re = globToUrlRegExp('https://api.example.com/users/*')
    expect(re.test('https://api.example.com/users/123')).toBe(true)
    expect(re.test('https://api.example.com/users/123/orders')).toBe(true)
    expect(re.test('https://api.example.com/orders/123')).toBe(false)
  })

  test('regex metacharacters in the pattern are matched literally', () => {
    // '.' must match a literal dot, not "any character".
    const re = globToUrlRegExp('https://api.example.com/*')
    expect(re.test('https://apiXexample.com/x')).toBe(false)
    expect(re.test('https://api.example.com/x')).toBe(true)
  })

  test('? is matched literally, not treated as a regex "0-or-1" quantifier', () => {
    // This regex is `prod.ts`'s production capture allowlist — an operator
    // writing a pattern with a literal '?' (e.g. a query string) must not
    // have it silently reinterpreted as a regex quantifier on the PRECEDING
    // character, which would widen the allowlist to also match URLs that
    // dropped the '?' entirely — exactly the over-matching the allowlist
    // exists to prevent.
    const re = globToUrlRegExp('https://api.example.com/search?q=*')
    // The literal '?' is required and matched as itself.
    expect(re.test('https://api.example.com/search?q=widgets')).toBe(true)
    // Unescaped, '?' makes the preceding 'h' optional instead of requiring a
    // literal '?' — so a URL missing the '?' character altogether would
    // incorrectly match. It must not.
    expect(re.test('https://api.example.com/searchq=widgets')).toBe(false)
    expect(re.test('https://api.example.com/searcq=widgets')).toBe(false)
  })

  test('matching is case-insensitive', () => {
    const re = globToUrlRegExp('https://api.example.com/*')
    expect(re.test('HTTPS://API.EXAMPLE.COM/x')).toBe(true)
  })
})
