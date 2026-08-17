import {
  extractSetCookieValues,
  parseCookies,
  parseRequestCookies,
  parseSetCookieDirective,
} from '../../src/ui/utils/cookieParsers'

describe('parseRequestCookies', () => {
  it('parses a single name=value pair', () => {
    const result = parseRequestCookies('session=abc123')
    expect(result).toEqual([{ name: 'session', value: 'abc123' }])
  })

  it('parses multiple semicolon-separated pairs', () => {
    const result = parseRequestCookies('session=abc123; user=john; theme=dark')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ name: 'session', value: 'abc123' })
    expect(result[1]).toEqual({ name: 'user', value: 'john' })
    expect(result[2]).toEqual({ name: 'theme', value: 'dark' })
  })

  it('handles values containing = signs', () => {
    const result = parseRequestCookies('token=abc=def==')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ name: 'token', value: 'abc=def==' })
  })

  it('handles empty value', () => {
    const result = parseRequestCookies('empty=')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ name: 'empty', value: '' })
  })

  it('ignores empty segments', () => {
    const result = parseRequestCookies('a=1;;b=2')
    expect(result).toHaveLength(2)
  })
})

describe('parseSetCookieDirective', () => {
  it('parses a simple Set-Cookie value', () => {
    const result = parseSetCookieDirective('id=42')
    expect(result.name).toBe('id')
    expect(result.value).toBe('42')
    expect(result.attributes).toBeUndefined()
  })

  it('parses attributes', () => {
    const result = parseSetCookieDirective('session=xyz; Path=/; HttpOnly; Secure')
    expect(result.name).toBe('session')
    expect(result.value).toBe('xyz')
    expect(result.attributes).toBe('Path=/; HttpOnly; Secure')
  })

  it('parses Max-Age and SameSite attributes', () => {
    const result = parseSetCookieDirective('token=abc; Max-Age=3600; SameSite=Strict')
    expect(result.name).toBe('token')
    expect(result.value).toBe('abc')
    expect(result.attributes).toBe('Max-Age=3600; SameSite=Strict')
  })

  it('handles missing value (name only)', () => {
    const result = parseSetCookieDirective('deleted; Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    expect(result.name).toBe('deleted')
    expect(result.value).toBe('')
  })
})

describe('extractSetCookieValues', () => {
  it('returns empty array when no Set-Cookie header', () => {
    expect(extractSetCookieValues({ 'Content-Type': 'application/json' })).toEqual([])
  })

  it('returns single directive when no comma', () => {
    const result = extractSetCookieValues({ 'set-cookie': 'a=1; Path=/' })
    expect(result).toEqual(['a=1; Path=/'])
  })

  it('is case-insensitive for header name', () => {
    const result = extractSetCookieValues({ 'Set-Cookie': 'a=1' })
    expect(result).toHaveLength(1)
  })

  it('splits multiple Set-Cookie values joined by ", "', () => {
    // Browsers and some interceptors join multiple Set-Cookie headers with ", "
    const raw = 'a=1; Path=/, b=2; HttpOnly'
    const result = extractSetCookieValues({ 'set-cookie': raw })
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('a=1; Path=/')
    expect(result[1]).toBe('b=2; HttpOnly')
  })
})

describe('parseCookies', () => {
  it('returns empty array for null headers', () => {
    expect(parseCookies(null, 'request')).toEqual([])
    expect(parseCookies(null, 'response')).toEqual([])
  })

  it('returns empty array when no Cookie/Set-Cookie header', () => {
    expect(parseCookies({ 'Content-Type': 'text/html' }, 'request')).toEqual([])
    expect(parseCookies({ 'Content-Type': 'text/html' }, 'response')).toEqual([])
  })

  it('parses request Cookie header', () => {
    const headers = { Cookie: 'session=abc; user=jane' }
    const result = parseCookies(headers, 'request')
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('session')
    expect(result[1].name).toBe('user')
  })

  it('parses response Set-Cookie header', () => {
    const headers = { 'set-cookie': 'token=xyz; Path=/; HttpOnly' }
    const result = parseCookies(headers, 'response')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('token')
    expect(result[0].value).toBe('xyz')
    expect(result[0].attributes).toBe('Path=/; HttpOnly')
  })

  it('is case-insensitive for header lookup', () => {
    expect(parseCookies({ COOKIE: 'a=1' }, 'request')).toHaveLength(1)
    expect(parseCookies({ 'SET-COOKIE': 'a=1' }, 'response')).toHaveLength(1)
  })
})
