import { describe, expect, test } from 'bun:test'

import {
  DEFAULT_SENSITIVE_HEADERS,
  isSensitiveHeader,
  redactHeaders,
  redactHeaderValues,
  stripHeaders,
} from '../headerRedaction'

describe('isSensitiveHeader', () => {
  test('matches default sensitive headers case-insensitively', () => {
    expect(isSensitiveHeader('Authorization')).toBe(true)
    expect(isSensitiveHeader('authorization')).toBe(true)
    expect(isSensitiveHeader('COOKIE')).toBe(true)
    expect(isSensitiveHeader('Set-Cookie')).toBe(true)
    expect(isSensitiveHeader('X-Api-Key')).toBe(true)
  })

  test('non-sensitive headers are not flagged', () => {
    expect(isSensitiveHeader('content-type')).toBe(false)
    expect(isSensitiveHeader('accept')).toBe(false)
    expect(isSensitiveHeader('user-agent')).toBe(false)
  })

  test('every DEFAULT_SENSITIVE_HEADERS entry is detected', () => {
    for (const h of DEFAULT_SENSITIVE_HEADERS) {
      expect(isSensitiveHeader(h.toUpperCase())).toBe(true)
    }
  })

  test('glob patterns (x-*) and regex literals (/token/) match', () => {
    expect(isSensitiveHeader('x-secret-thing', ['x-*'])).toBe(true)
    expect(isSensitiveHeader('content-type', ['x-*'])).toBe(false)
    expect(isSensitiveHeader('x-csrf-token', ['/token/'])).toBe(true)
    expect(isSensitiveHeader('refresh-token', ['/token$/'])).toBe(true)
    expect(isSensitiveHeader('accept', ['/token/'])).toBe(false)
  })
})

describe('redactHeaders', () => {
  test('replaces sensitive values with the placeholder, keeps the key', () => {
    const out = redactHeaders({ Authorization: 'Bearer abc', 'content-type': 'application/json' })
    expect(out.Authorization).toBe('[REDACTED]')
    expect(out['content-type']).toBe('application/json')
  })

  test('does not mutate the input object', () => {
    const input = { authorization: 'secret' }
    const out = redactHeaders(input)
    expect(input.authorization).toBe('secret')
    expect(out.authorization).toBe('[REDACTED]')
  })

  test('returns {} for undefined input', () => {
    expect(redactHeaders(undefined)).toEqual({})
  })

  test('honours a custom sensitive list', () => {
    const out = redactHeaders({ 'x-trace': 't', authorization: 'a' }, ['x-trace'])
    expect(out['x-trace']).toBe('[REDACTED]')
    expect(out.authorization).toBe('a') // not in the custom list
  })
})

describe('redactHeaderValues', () => {
  test('replaces every value of a sensitive header name, keeps the key', () => {
    const out = redactHeaderValues({ 'set-cookie': ['a=1', 'b=2'], 'content-type': ['application/json'] })
    expect(out?.['set-cookie']).toEqual(['[REDACTED]', '[REDACTED]'])
    expect(out?.['content-type']).toEqual(['application/json'])
  })

  test('does not mutate the input object', () => {
    const input = { 'set-cookie': ['secret'] }
    const out = redactHeaderValues(input)
    expect(input['set-cookie']).toEqual(['secret'])
    expect(out?.['set-cookie']).toEqual(['[REDACTED]'])
  })

  test('returns undefined for undefined input (not {}) — absent stays absent', () => {
    expect(redactHeaderValues(undefined)).toBeUndefined()
  })

  test('honours a custom sensitive list', () => {
    const out = redactHeaderValues({ 'x-trace': ['t1', 't2'], 'set-cookie': ['a'] }, ['x-trace'])
    expect(out?.['x-trace']).toEqual(['[REDACTED]', '[REDACTED]'])
    expect(out?.['set-cookie']).toEqual(['a']) // not in the custom list
  })
})

describe('stripHeaders', () => {
  test('removes sensitive keys entirely', () => {
    const out = stripHeaders({ cookie: 'a=b', accept: '*/*' })
    expect('cookie' in out).toBe(false)
    expect(out.accept).toBe('*/*')
  })

  test('returns {} for undefined input', () => {
    expect(stripHeaders(undefined)).toEqual({})
  })
})

describe('DEFAULT_SENSITIVE_HEADERS — expanded list', () => {
  const expandedHeaders: Record<string, string> = {
    'x-token': 'tok1',
    token: 'tok2',
    'x-secret': 'sec1',
    'x-session-token': 'sess1',
    'x-amz-security-token': 'amz1',
    'private-token': 'pt1',
    'x-client-secret': 'cs1',
    session: 'sess2',
  }

  test('redacts all newly-added exact-match headers', () => {
    const out = redactHeaders(expandedHeaders)
    for (const key of Object.keys(expandedHeaders)) {
      expect(out[key]).toBe('[REDACTED]')
    }
  })

  test('redacts x-*-token glob variants', () => {
    const out = redactHeaders({ 'x-custom-token': 'val', 'x-other-token': 'val2' })
    expect(out['x-custom-token']).toBe('[REDACTED]')
    expect(out['x-other-token']).toBe('[REDACTED]')
  })

  test('redacts x-*-secret glob variants', () => {
    const out = redactHeaders({ 'x-app-secret': 'val', 'x-internal-secret': 'val2' })
    expect(out['x-app-secret']).toBe('[REDACTED]')
    expect(out['x-internal-secret']).toBe('[REDACTED]')
  })

  test('does not redact unrelated headers', () => {
    const out = redactHeaders({ 'content-type': 'application/json', accept: '*/*' })
    expect(out['content-type']).toBe('application/json')
    expect(out['accept']).toBe('*/*')
  })

  test('every DEFAULT_SENSITIVE_HEADERS plain-string entry is detected (case-insensitive)', () => {
    const plainEntries = DEFAULT_SENSITIVE_HEADERS.filter((h) => !h.includes('*') && !h.startsWith('/'))
    for (const h of plainEntries) {
      expect(isSensitiveHeader(h.toUpperCase())).toBe(true)
    }
  })
})
