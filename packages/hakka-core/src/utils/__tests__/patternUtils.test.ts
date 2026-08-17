import { describe, expect, test } from 'bun:test'

import { globToRegExp, regexLiteralToRegExp } from '../patternUtils'

describe('regexLiteralToRegExp', () => {
  test('parses a valid regex literal', () => {
    const re = regexLiteralToRegExp('/foo/')
    expect(re).not.toBeNull()
    expect(re!.test('foobar')).toBe(true)
    expect(re!.test('baz')).toBe(false)
  })

  test('is case-insensitive', () => {
    const re = regexLiteralToRegExp('/token$/')
    expect(re!.test('refresh-TOKEN')).toBe(true)
  })

  test('returns null for plain strings (no slashes)', () => {
    expect(regexLiteralToRegExp('foo')).toBeNull()
  })

  test('returns null for strings that are too short', () => {
    expect(regexLiteralToRegExp('//')).toBeNull()
  })

  test('returns null for invalid regex content', () => {
    expect(regexLiteralToRegExp('/[invalid/')).toBeNull()
  })
})

describe('globToRegExp', () => {
  test('matches exact pattern without wildcard', () => {
    const re = globToRegExp('example.com')
    expect(re.test('example.com')).toBe(true)
    expect(re.test('sub.example.com')).toBe(false)
  })

  test('* matches any segment', () => {
    const re = globToRegExp('*.analytics.com')
    expect(re.test('foo.analytics.com')).toBe(true)
    expect(re.test('bar.analytics.com')).toBe(true)
    expect(re.test('analytics.com')).toBe(false)
  })

  test('escapes regex special characters in the pattern', () => {
    const re = globToRegExp('x-*-token')
    expect(re.test('x-foo-token')).toBe(true)
    expect(re.test('x-bar-token')).toBe(true)
    expect(re.test('y-foo-token')).toBe(false)
  })

  test('is case-insensitive', () => {
    const re = globToRegExp('X-*-SECRET')
    expect(re.test('x-anything-secret')).toBe(true)
  })
})
