import { describe, expect, test } from 'bun:test'

import { buildMitmproxyHostArgs, MAX_TLS_HOST_LENGTH, MAX_TLS_HOSTS, mitmproxyHostPattern } from '../tlsHostScope'

describe('TLS host scope', () => {
  test('anchors an exact domain to host and port', () => {
    const pattern = mitmproxyHostPattern('api.example.com')
    expect(pattern).toBe('^api\\.example\\.com:\\d+$')
    const expression = new RegExp(pattern)
    expect(expression.test('api.example.com:443')).toBe(true)
    expect(expression.test('api.example.com.evil.test:443')).toBe(false)
    expect(expression.test('other.api.example.com:443')).toBe(false)
  })

  test('matches wildcard entries only below the named domain', () => {
    const expression = new RegExp(mitmproxyHostPattern('*.example.com:443'))
    expect(expression.test('api.example.com:443')).toBe(true)
    expect(expression.test('deep.api.example.com:443')).toBe(true)
    expect(expression.test('example.com:443')).toBe(false)
    expect(expression.test('api.example.com:8443')).toBe(false)
    expect(expression.test('api.example.com.evil.test:443')).toBe(false)
  })

  test('uses mitmproxy bypass and allow-only flags without duplicate patterns', () => {
    expect(buildMitmproxyHostArgs({ mode: 'bypass', hosts: ['api.example.com', 'api.example.com'] })).toEqual([
      '--ignore-hosts',
      '^api\\.example\\.com:\\d+$',
    ])
    expect(buildMitmproxyHostArgs({ mode: 'allowOnly', hosts: ['*.example.com:443'] })).toEqual([
      '--allow-hosts',
      '^(?:[a-z0-9-]+\\.)+example\\.com:443$',
    ])
  })

  test('normalizes numeric ports so leading zeroes match the actual port', () => {
    expect(mitmproxyHostPattern('api.example.com:00443')).toBe('^api\\.example\\.com:443$')
  })

  test('rejects invalid syntax and bounded-scope violations', () => {
    for (const input of [
      '.*',
      'example.com|evil.test',
      'api..example.com',
      '*.example.*',
      'api.example.com:+443',
      'api.example.com:0',
      'api.example.com:65536',
    ])
      expect(() => mitmproxyHostPattern(input)).toThrow('Invalid TLS host scope')
    expect(() => mitmproxyHostPattern(`a${'a'.repeat(MAX_TLS_HOST_LENGTH)}.test`)).toThrow('at most')
    expect(() => buildMitmproxyHostArgs({ mode: 'allowOnly', hosts: [] })).toThrow('requires at least one host')
    expect(() =>
      buildMitmproxyHostArgs({
        mode: 'bypass',
        hosts: Array.from({ length: MAX_TLS_HOSTS + 1 }, () => 'api.example.com'),
      }),
    ).toThrow('at most')
    expect(() => buildMitmproxyHostArgs({ mode: 'invalid' as never, hosts: [] })).toThrow(
      'mode must be bypass or allowOnly',
    )
  })
})
