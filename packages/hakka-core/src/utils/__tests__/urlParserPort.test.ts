import { describe, expect, test } from 'bun:test'

import { parseUrl } from '../urlParser'

// Covers port-bearing host cases beyond urlParser.test.ts's localhost:3000 regression guard: default-port normalization (443/80 dropped from `.host`) and an IPv6 literal host carrying a port.

describe('parseUrl — port-bearing host extraction', () => {
  test('a non-default https port is preserved in host', () => {
    const result = parseUrl('https://example.com:8443/api')
    expect(result.host).toBe('example.com:8443')
    expect(result.path).toBe('/api')
    expect(result.isSecure).toBe(true)
  })

  test('the default https port (443) is normalized away from host', () => {
    const result = parseUrl('https://example.com:443/api')
    expect(result.host).toBe('example.com')
    expect(result.host).not.toContain(':443')
  })

  test('the default http port (80) is normalized away from host', () => {
    const result = parseUrl('http://example.com:80/api')
    expect(result.host).toBe('example.com')
    expect(result.host).not.toContain(':80')
  })

  test('an IPv6 literal host with a port is preserved in bracketed form', () => {
    const result = parseUrl('http://[::1]:8080/api')
    expect(result.host).toBe('[::1]:8080')
    expect(result.path).toBe('/api')
  })

  test('an IPv6 literal host without a port has no trailing colon-port', () => {
    const result = parseUrl('http://[::1]/api')
    expect(result.host).toBe('[::1]')
  })
})
