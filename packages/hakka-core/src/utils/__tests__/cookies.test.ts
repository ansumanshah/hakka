import { describe, it, expect } from 'bun:test'

import { parseRequestCookies, parseSetCookie } from '../cookies'

describe('parseRequestCookies', () => {
  it('returns empty array for undefined', () => {
    expect(parseRequestCookies(undefined)).toEqual([])
  })

  it('parses a single cookie', () => {
    expect(parseRequestCookies('session=abc123')).toEqual([{ name: 'session', value: 'abc123' }])
  })

  it('parses multiple cookies separated by semicolons', () => {
    const result = parseRequestCookies('a=1; b=2; c=3')
    expect(result).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
      { name: 'c', value: '3' },
    ])
  })

  it('handles cookies with = in the value', () => {
    const result = parseRequestCookies('token=abc=def==')
    expect(result).toEqual([{ name: 'token', value: 'abc=def==' }])
  })

  it('handles a cookie with no value', () => {
    const result = parseRequestCookies('flag')
    expect(result).toEqual([{ name: 'flag', value: '' }])
  })

  it('trims whitespace around name and value', () => {
    const result = parseRequestCookies('  sid = xyz ')
    expect(result).toEqual([{ name: 'sid', value: 'xyz' }])
  })
})

describe('parseSetCookie', () => {
  it('returns empty array for undefined', () => {
    expect(parseSetCookie(undefined)).toEqual([])
  })

  it('parses a basic Set-Cookie with no attributes', () => {
    const result = parseSetCookie('session=abc123')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'session', value: 'abc123', httpOnly: false, secure: false })
  })

  it('parses all attributes', () => {
    const result = parseSetCookie(
      'id=xyz; Domain=example.com; Path=/api; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=3600; HttpOnly; Secure; SameSite=Strict',
    )
    expect(result).toHaveLength(1)
    const c = result[0]!
    expect(c.name).toBe('id')
    expect(c.value).toBe('xyz')
    expect(c.domain).toBe('example.com')
    expect(c.path).toBe('/api')
    expect(c.expires).toBe('Thu, 01 Jan 2099 00:00:00 GMT')
    expect(c.maxAge).toBe(3600)
    expect(c.httpOnly).toBe(true)
    expect(c.secure).toBe(true)
    expect(c.sameSite).toBe('Strict')
  })

  it('parses case-insensitive attribute keys', () => {
    const result = parseSetCookie('a=b; HTTPONLY; SECURE; samesite=lax')
    expect(result[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax' })
  })

  it('parses an array of Set-Cookie strings', () => {
    const result = parseSetCookie(['session=abc; HttpOnly', 'theme=dark; Path=/'])
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'session', value: 'abc', httpOnly: true })
    expect(result[1]).toMatchObject({ name: 'theme', value: 'dark', path: '/' })
  })

  it('parses a newline-joined multi-cookie string', () => {
    const result = parseSetCookie('a=1; Secure\nb=2; HttpOnly')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ name: 'a', secure: true })
    expect(result[1]).toMatchObject({ name: 'b', httpOnly: true })
  })

  it('handles SameSite=None', () => {
    const result = parseSetCookie('cross=site; SameSite=None; Secure')
    expect(result[0]).toMatchObject({ sameSite: 'None', secure: true })
  })
})
