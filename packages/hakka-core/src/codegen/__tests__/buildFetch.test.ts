import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildFetch } from '../buildFetch'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'test-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    startTime: 0,
    ...overrides,
  }
}

describe('buildFetch', () => {
  test('emits method, url, and a header', () => {
    const snippet = buildFetch(
      makeRequest({
        method: 'POST',
        requestHeaders: { 'Content-Type': 'application/json' },
        requestBody: '{"key":"value"}',
      }),
    )
    expect(snippet).toContain('fetch(')
    expect(snippet).toContain('https://api.example.com/v1/items')
    expect(snippet).toContain("method: 'POST'")
    expect(snippet).toContain('Content-Type')
    expect(snippet).toContain('application/json')
    expect(snippet).toContain('{"key":"value"}')
  })

  test('simple GET has no headers or body block', () => {
    const snippet = buildFetch(makeRequest())
    expect(snippet).not.toContain('headers:')
    expect(snippet).not.toContain('body:')
  })

  test('escapes embedded single quotes in header values', () => {
    const snippet = buildFetch(makeRequest({ requestHeaders: { 'X-Custom': "it's here" } }))
    expect(snippet).toContain("it\\'s here")
  })

  test('[REDACTED] header value passes through as literal text', () => {
    const snippet = buildFetch(makeRequest({ requestHeaders: { Authorization: '[REDACTED]' } }))
    expect(snippet).toContain('[REDACTED]')
  })
})
