import { parseUrl, splitPathAndQuery } from 'hakka-core'

describe('parseUrl', () => {
  it('parses a simple HTTP URL', () => {
    const result = parseUrl('http://example.com/path')
    expect(result.host).toBe('example.com')
    expect(result.path).toBe('/path')
    expect(result.isSecure).toBe(false)
  })

  it('parses a HTTPS URL', () => {
    const result = parseUrl('https://api.example.com/v1/users')
    expect(result.host).toBe('api.example.com')
    expect(result.path).toBe('/v1/users')
    expect(result.isSecure).toBe(true)
  })

  it('handles URL with query string', () => {
    const result = parseUrl('https://example.com/search?q=hello&page=1')
    expect(result.host).toBe('example.com')
    expect(result.path).toBe('/search?q=hello&page=1')
    expect(result.isSecure).toBe(true)
  })

  it('handles URL without path (root)', () => {
    const result = parseUrl('https://example.com')
    expect(result.host).toBe('example.com')
    expect(result.path).toBe('/')
  })

  it('handles empty string', () => {
    const result = parseUrl('')
    expect(result.host).toBe('')
    expect(result.isSecure).toBe(false)
  })
})

describe('splitPathAndQuery', () => {
  it('handles path with just a question mark', () => {
    const result = splitPathAndQuery('/path?')
    expect(result.pathPart).toBe('/path')
    expect(result.queryPart).toBe('?')
  })

  it('handles empty string', () => {
    const result = splitPathAndQuery('')
    expect(result.pathPart).toBe('')
    expect(result.queryPart).toBe('')
  })
})
