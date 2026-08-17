import { limitBodySize, isBodyTruncated, estimateBodySize, DEFAULT_MAX_BODY_SIZE } from 'hakka-core'

describe('limitBodySize', () => {
  it('returns undefined when body is undefined', () => {
    expect(limitBodySize(undefined)).toBeUndefined()
  })

  it('returns body unchanged when within limit', () => {
    const body = 'hello world'
    expect(limitBodySize(body, 100)).toBe(body)
  })

  it('truncates body when it exceeds limit', () => {
    const body = 'A'.repeat(200)
    const result = limitBodySize(body, 100)
    expect(result).not.toBeUndefined()
    expect(result!.startsWith('A'.repeat(100))).toBe(true)
    expect(result!).toContain('[TRUNCATED')
  })

  it('uses DEFAULT_MAX_BODY_SIZE when no limit provided', () => {
    const smallBody = 'small'
    expect(limitBodySize(smallBody)).toBe(smallBody)

    const largeBody = 'X'.repeat(DEFAULT_MAX_BODY_SIZE + 1000)
    const result = limitBodySize(largeBody)
    expect(result!.length).toBeLessThan(largeBody.length)
    expect(isBodyTruncated(result)).toBe(true)
  })

  it('handles empty string', () => {
    expect(limitBodySize('', 100)).toBe('')
  })

  it('handles body exactly at limit (no truncation)', () => {
    const body = 'A'.repeat(100)
    expect(limitBodySize(body, 100)).toBe(body)
  })
})

describe('isBodyTruncated', () => {
  it('returns false for undefined', () => {
    expect(isBodyTruncated(undefined)).toBe(false)
  })

  it('returns false for non-truncated body', () => {
    expect(isBodyTruncated('hello world')).toBe(false)
  })

  it('returns true for truncated body', () => {
    const truncated = limitBodySize('A'.repeat(200), 50)
    expect(isBodyTruncated(truncated)).toBe(true)
  })
})

describe('estimateBodySize', () => {
  it('returns 0 for undefined', () => {
    expect(estimateBodySize(undefined)).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(estimateBodySize('')).toBe(0)
  })

  it('returns string length as byte estimate', () => {
    expect(estimateBodySize('hello')).toBe(5)
    expect(estimateBodySize('A'.repeat(1024))).toBe(1024)
  })
})

describe('DEFAULT_MAX_BODY_SIZE', () => {
  it('is 100 KB', () => {
    expect(DEFAULT_MAX_BODY_SIZE).toBe(100 * 1024)
  })
})
