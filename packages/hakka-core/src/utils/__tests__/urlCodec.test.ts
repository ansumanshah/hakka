import { describe, it, expect } from 'bun:test'

import { isUrlEncoded, decodeUrl, encodeUrl } from '../urlCodec'

describe('isUrlEncoded', () => {
  it('returns true for a URL with %XX sequence', () => {
    expect(isUrlEncoded('https://example.com/path?q=hello%20world')).toBe(true)
  })

  it('returns false for a plain URL', () => {
    expect(isUrlEncoded('https://example.com/path?q=hello world')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isUrlEncoded('')).toBe(false)
  })

  it('returns true for %2F in path', () => {
    expect(isUrlEncoded('/api%2Fv1')).toBe(true)
  })
})

describe('decodeUrl', () => {
  it('decodes a percent-encoded URL', () => {
    expect(decodeUrl('https://example.com/search?q=hello%20world')).toBe('https://example.com/search?q=hello world')
  })

  it('returns original string for a non-encoded URL', () => {
    const url = 'https://example.com/path'
    expect(decodeUrl(url)).toBe(url)
  })

  it('falls back to original on malformed encoding', () => {
    const malformed = 'https://example.com/%GG'
    expect(decodeUrl(malformed)).toBe(malformed)
  })

  it('decodes unicode sequences', () => {
    expect(decodeUrl('%E4%B8%AD%E6%96%87')).toBe('中文')
  })
})

describe('encodeUrl', () => {
  it('is a no-op on an already-encoded URL', () => {
    const encoded = 'https://example.com/search?q=hello%20world'
    expect(encodeUrl(encoded)).toBe(encoded)
  })

  it('encodes a URL with spaces', () => {
    const result = encodeUrl('https://example.com/search?q=hello world')
    expect(result).toContain('%20')
    expect(result).not.toContain(' ')
  })

  it('preserves unreserved chars', () => {
    const url = 'https://example.com/path-to_resource.txt'
    expect(encodeUrl(url)).toBe(url)
  })

  it('round-trips through decode then encode', () => {
    const original = 'https://example.com/path?q=hello%20world&lang=en'
    const decoded = decodeUrl(original)
    const reencoded = encodeUrl(decoded)
    expect(reencoded).toContain('%20')
    expect(reencoded).not.toContain(' ')
  })
})
