import { describe, expect, test } from 'bun:test'

import { DEFAULT_MAX_BODY_SIZE, estimateBodySize, isBodyTruncated, limitBodySize } from '../bodySizeLimit'

describe('limitBodySize', () => {
  test('returns undefined unchanged', () => {
    expect(limitBodySize(undefined)).toBeUndefined()
  })

  test('passes a body under the limit through unchanged', () => {
    expect(limitBodySize('hello', 100)).toBe('hello')
  })

  test('passes a body exactly at the limit through unchanged (boundary)', () => {
    const body = 'x'.repeat(10)
    expect(limitBodySize(body, 10)).toBe(body)
  })

  test('truncates a body one char over the limit and appends the truncation marker', () => {
    const body = 'x'.repeat(11)
    const result = limitBodySize(body, 10)
    expect(result?.startsWith('x'.repeat(10))).toBe(true)
    expect(result).toContain('[TRUNCATED')
    expect(result?.length).toBeGreaterThan(10)
  })

  test('uses DEFAULT_MAX_BODY_SIZE (100 KB) when maxBytes is omitted', () => {
    const underDefault = 'a'.repeat(DEFAULT_MAX_BODY_SIZE)
    expect(limitBodySize(underDefault)).toBe(underDefault)

    const overDefault = 'a'.repeat(DEFAULT_MAX_BODY_SIZE + 1)
    const result = limitBodySize(overDefault)
    expect(result).toContain('[TRUNCATED')
    expect(result?.startsWith('a'.repeat(DEFAULT_MAX_BODY_SIZE))).toBe(true)
  })
})

describe('isBodyTruncated', () => {
  test('returns false for undefined', () => {
    expect(isBodyTruncated(undefined)).toBe(false)
  })

  test('returns false for a body without the marker', () => {
    expect(isBodyTruncated('just a normal body')).toBe(false)
  })

  test('returns true for output produced by limitBodySize when truncation occurred', () => {
    const truncated = limitBodySize('x'.repeat(20), 5)
    expect(isBodyTruncated(truncated)).toBe(true)
  })

  test('returns false for output produced by limitBodySize when nothing was truncated', () => {
    const untouched = limitBodySize('short', 100)
    expect(isBodyTruncated(untouched)).toBe(false)
  })

  test('a body that merely contains the marker text mid-string (not as a suffix) is not considered truncated', () => {
    expect(isBodyTruncated('[TRUNCATED — body exceeded size limit] plus extra trailing text')).toBe(false)
  })
})

describe('estimateBodySize', () => {
  test('returns 0 for undefined', () => {
    expect(estimateBodySize(undefined)).toBe(0)
  })

  test('returns the string length for a plain ASCII body', () => {
    expect(estimateBodySize('hello world')).toBe(11)
  })

  test('reflects the length of an already-truncated body (marker included), not the pre-truncation size', () => {
    const truncated = limitBodySize('y'.repeat(500), 10)!
    expect(estimateBodySize(truncated)).toBe(truncated.length)
    expect(estimateBodySize(truncated)).toBeLessThan(500)
  })
})
