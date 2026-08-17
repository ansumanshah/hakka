import { DEFAULT_CONFIG, redactHeaders, stripHeaders, isSensitiveHeader, DEFAULT_SENSITIVE_HEADERS } from 'hakka-core'

describe('redactHeaders', () => {
  it('is case-insensitive for header names', () => {
    const headers = {
      Authorization: 'Bearer token',
      COOKIE: 'session=abc',
      'Content-Type': 'application/json',
    }
    const result = redactHeaders(headers)
    expect(result['Authorization']).toBe('[REDACTED]')
    expect(result['COOKIE']).toBe('[REDACTED]')
    expect(result['Content-Type']).toBe('application/json')
  })

  it('supports wildcard and regex sensitive headers', () => {
    const headers = {
      'X-Access-Token': 'secret',
      'x-secret-42': 'secret',
      'content-type': 'application/json',
    }
    const result = redactHeaders(headers, ['x-*-token', '/^x-secret-\\d+$/'])
    expect(result['X-Access-Token']).toBe('[REDACTED]')
    expect(result['x-secret-42']).toBe('[REDACTED]')
    expect(result['content-type']).toBe('application/json')
  })

  it('handles empty headers object', () => {
    expect(redactHeaders({})).toEqual({})
  })
})

describe('stripHeaders', () => {
  it('is case-insensitive', () => {
    const headers = {
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
    }
    const result = stripHeaders(headers)
    expect(result['Authorization']).toBeUndefined()
    expect(result['Content-Type']).toBe('application/json')
  })

  it('uses custom sensitive headers list', () => {
    const headers = { 'x-my-secret': 'value', 'x-other': 'ok' }
    const result = stripHeaders(headers, ['x-my-secret'])
    expect(result['x-my-secret']).toBeUndefined()
    expect(result['x-other']).toBe('ok')
  })
})

describe('isSensitiveHeader', () => {
  it('supports custom sensitive headers list', () => {
    expect(isSensitiveHeader('x-custom', ['x-custom'])).toBe(true)
    expect(isSensitiveHeader('authorization', ['x-custom'])).toBe(false)
  })

  it('supports wildcard and regex sensitive headers', () => {
    expect(isSensitiveHeader('X-Access-Token', ['x-*-token'])).toBe(true)
    expect(isSensitiveHeader('x-secret-42', ['/^x-secret-\\d+$/'])).toBe(true)
    expect(isSensitiveHeader('x-secret-name', ['/^x-secret-\\d+$/'])).toBe(false)
  })
})

describe('DEFAULT_SENSITIVE_HEADERS', () => {
  it('includes expected headers', () => {
    expect(DEFAULT_SENSITIVE_HEADERS).toContain('authorization')
    expect(DEFAULT_SENSITIVE_HEADERS).toContain('proxy-authorization')
    expect(DEFAULT_SENSITIVE_HEADERS).toContain('cookie')
    expect(DEFAULT_SENSITIVE_HEADERS).toContain('set-cookie')
    expect(DEFAULT_SENSITIVE_HEADERS).toContain('x-api-key')
  })
})

describe('DEFAULT_CONFIG', () => {
  it('redacts proxy authorization by default', () => {
    expect(DEFAULT_CONFIG.redactHeaders).toContain('proxy-authorization')
  })
})
