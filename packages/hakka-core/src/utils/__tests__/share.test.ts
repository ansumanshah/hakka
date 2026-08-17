import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildCurl } from '../share'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'test-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    startTime: 0,
    ...overrides,
  }
}

describe('buildCurl — basic', () => {
  test('simple GET with no headers or body', () => {
    const cmd = buildCurl(makeRequest())
    expect(cmd).toBe("curl -X GET 'https://api.example.com/v1/items'")
  })

  test('POST with body', () => {
    const cmd = buildCurl(
      makeRequest({
        method: 'POST',
        url: 'https://api.example.com/data',
        requestBody: '{"key":"value"}',
      }),
    )
    expect(cmd).toContain('--data-binary \'{"key":"value"}\'')
  })
})

describe('buildCurl — shell-safety', () => {
  test('URL with spaces is single-quoted', () => {
    const cmd = buildCurl(makeRequest({ url: 'https://example.com/path with spaces' }))
    expect(cmd).toContain("'https://example.com/path with spaces'")
  })

  test('header value with embedded double-quote is single-quoted', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { 'X-Custom': 'val"ue' },
      }),
    )
    expect(cmd).toContain("-H 'X-Custom: val\"ue'")
  })

  test('header value with embedded single-quote is escaped', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { 'X-Custom': "it's here" },
      }),
    )
    // Single quote in value becomes '\'' within the single-quoted shell argument
    expect(cmd).toContain("-H 'X-Custom: it'\\''s here'")
  })

  test('body with embedded single-quote is escaped', () => {
    const cmd = buildCurl(
      makeRequest({
        method: 'POST',
        requestBody: "body with 'quotes'",
      }),
    )
    expect(cmd).toContain("--data-binary 'body with '\\''quotes'\\'''")
  })

  test('body with backslashes is preserved', () => {
    const cmd = buildCurl(
      makeRequest({
        method: 'POST',
        requestBody: 'path\\to\\file',
      }),
    )
    expect(cmd).toContain("--data-binary 'path\\to\\file'")
  })
})

describe('buildCurl — --compressed', () => {
  // Only response Content-Encoding should trigger --compressed.

  test('appends --compressed when response Content-Encoding is gzip', () => {
    const cmd = buildCurl(
      makeRequest({
        responseHeaders: { 'Content-Encoding': 'gzip' },
      }),
    )
    expect(cmd).toContain('--compressed')
  })

  test('appends --compressed when response content-encoding (lowercase) is gzip', () => {
    const cmd = buildCurl(
      makeRequest({
        responseHeaders: { 'content-encoding': 'gzip' },
      }),
    )
    expect(cmd).toContain('--compressed')
  })

  test('appends --compressed for br response encoding', () => {
    const cmd = buildCurl(
      makeRequest({
        responseHeaders: { 'content-encoding': 'br' },
      }),
    )
    expect(cmd).toContain('--compressed')
  })

  test('appends --compressed for deflate response encoding', () => {
    const cmd = buildCurl(
      makeRequest({
        responseHeaders: { 'Content-Encoding': 'deflate' },
      }),
    )
    expect(cmd).toContain('--compressed')
  })

  test('does NOT append --compressed when no compression header present', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { 'Content-Type': 'application/json' },
      }),
    )
    expect(cmd).not.toContain('--compressed')
  })

  test('does NOT append --compressed when only request Accept-Encoding is set (no response Content-Encoding)', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { 'Accept-Encoding': 'gzip, deflate, br' },
      }),
    )
    expect(cmd).not.toContain('--compressed')
    expect(cmd).toContain('-H')
    expect(cmd).toContain('Accept-Encoding')
  })

  test('does NOT append --compressed when only request Accept-Encoding deflate, no response encoding', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { 'Accept-Encoding': 'deflate' },
      }),
    )
    expect(cmd).not.toContain('--compressed')
  })

  test('does NOT append --compressed when encoding is identity', () => {
    const cmd = buildCurl(
      makeRequest({
        responseHeaders: { 'content-encoding': 'identity' },
      }),
    )
    expect(cmd).not.toContain('--compressed')
  })

  test('--compressed AND request Accept-Encoding header coexist without duplication', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { 'Accept-Encoding': 'gzip' },
        responseHeaders: { 'Content-Encoding': 'gzip' },
      }),
    )
    expect(cmd).toContain("-H 'Accept-Encoding: gzip'")
    expect(cmd).toContain('--compressed')
    expect(cmd.split('--compressed').length - 1).toBe(1)
  })
})

describe('buildCurl — Basic auth', () => {
  test('decodes Authorization: Basic and emits -u flag', () => {
    // "user:secret" in Base64 = dXNlcjpzZWNyZXQ=
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { Authorization: 'Basic dXNlcjpzZWNyZXQ=' },
      }),
    )
    expect(cmd).toContain("-u 'user:secret'")
    expect(cmd).toContain('-H')
    expect(cmd).toContain('Authorization')
  })

  test('does NOT emit -u for Bearer tokens', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9' },
      }),
    )
    expect(cmd).not.toContain('-u')
    expect(cmd).toContain('Authorization')
  })

  test('handles case-insensitive authorization header', () => {
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { authorization: 'Basic dXNlcjpzZWNyZXQ=' },
      }),
    )
    expect(cmd).toContain("-u 'user:secret'")
  })

  test('credentials with single-quote are shell-escaped in -u flag', () => {
    // "user:p'ass" → dXNlcjpwJ2Fzcw==
    const encoded = btoa("user:p'ass")
    const cmd = buildCurl(
      makeRequest({
        requestHeaders: { Authorization: `Basic ${encoded}` },
      }),
    )
    expect(cmd).toContain("-u 'user:p'\\''ass'")
  })
})
