import { describe, expect, test } from 'bun:test'

import { parseUrl, splitPathAndQuery } from '../urlParser'

describe('parseUrl', () => {
  test('preserves port in host (regression guard: localhost:3000)', () => {
    const result = parseUrl('http://localhost:3000/api')
    expect(result.host).toBe('localhost:3000')
    expect(result.path).toBe('/api')
  })

  test('strips userinfo from host', () => {
    expect(parseUrl('https://user:pass@example.com/path').host).toBe('example.com')
  })

  test('handles query strings in path', () => {
    const result = parseUrl('https://example.com?q=1')
    expect(result.host).toBe('example.com')
    expect(result.path).toBe('/?q=1')
  })

  test('an @ inside the path is not mistaken for userinfo', () => {
    // The userinfo match runs to the LAST @ in the string, so an @ later in the path (as in every Metro asset URL) must not be mistaken for credentials.
    const metroAsset =
      'http://localhost:8081/assets/../../../../node_modules/.bun/react-native@0.85.3+13717e69d21c358c/node_modules/react-native/Libraries/LogBox/UI/LogBoxImages/chevron.png?platform=ios&hash=2fa0ed495f89aa964'
    const result = parseUrl(metroAsset)
    expect(result.host).toBe('localhost:8081')
    expect(result.path).toStartWith('/assets/')
    expect(result.path).toEndWith('?platform=ios&hash=2fa0ed495f89aa964')
  })

  test('a scoped npm package in the path keeps the real host', () => {
    expect(parseUrl('https://cdn.example.com/npm/@scope/pkg@1.2.3/dist/index.js').host).toBe('cdn.example.com')
  })

  test('wss is treated as a secure origin', () => {
    expect(parseUrl('wss://example.com/socket').isSecure).toBe(true)
    expect(parseUrl('ws://example.com/socket').isSecure).toBe(false)
  })

  test('returns empty host and original string for invalid URL', () => {
    const result = parseUrl('not-a-url')
    expect(result.host).toBe('')
    expect(result.path).toBe('not-a-url')
    expect(result.isSecure).toBe(false)
  })
})

describe('splitPathAndQuery', () => {
  test('splits path and query', () => {
    const result = splitPathAndQuery('/api/users?page=1&limit=10')
    expect(result.pathPart).toBe('/api/users')
    expect(result.queryPart).toBe('?page=1&limit=10')
  })

  test('returns empty queryPart when no query string', () => {
    const result = splitPathAndQuery('/api/users')
    expect(result.pathPart).toBe('/api/users')
    expect(result.queryPart).toBe('')
  })
})
