import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { generateMockRules } from '../mockFromTraffic'

let idSeq = 0
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idSeq++
  return {
    id: `req-${idSeq}`,
    url: 'https://api.example.com/users/1',
    method: 'GET',
    status: 200,
    startTime: idSeq,
    responseBody: '{"ok":true}',
    ...overrides,
  }
}

describe('generateMockRules — dedup: newest capture wins', () => {
  test('two requests to the same (method, path+query) collapse into one rule', () => {
    const older = makeRequest({
      url: 'https://api.example.com/users/1',
      method: 'GET',
      startTime: 1,
      status: 200,
      responseBody: '{"name":"old"}',
    })
    const newer = makeRequest({
      url: 'https://staging.example.com/users/1',
      method: 'GET',
      startTime: 2,
      status: 200,
      responseBody: '{"name":"new"}',
    })
    const rules = generateMockRules([older, newer])
    expect(rules.length).toBe(1)
    expect(rules[0]?.response.body).toBe('{"name":"new"}')
  })

  test('later array position wins on a startTime tie', () => {
    const a = makeRequest({ url: 'https://api.example.com/x', startTime: 5, responseBody: 'A' })
    const b = makeRequest({ url: 'https://api.example.com/x', startTime: 5, responseBody: 'B' })
    const rules = generateMockRules([a, b])
    expect(rules.length).toBe(1)
    expect(rules[0]?.response.body).toBe('B')
  })

  test('different methods to the same path are NOT deduped together', () => {
    const get = makeRequest({ url: 'https://api.example.com/users/1', method: 'GET' })
    const del = makeRequest({ url: 'https://api.example.com/users/1', method: 'DELETE', status: 204 })
    const rules = generateMockRules([get, del])
    expect(rules.length).toBe(2)
    expect(rules.map((r) => r.method).sort()).toEqual(['DELETE', 'GET'])
  })

  test('different query strings on the same path are NOT deduped together', () => {
    const a = makeRequest({ url: 'https://api.example.com/search?q=a' })
    const b = makeRequest({ url: 'https://api.example.com/search?q=b' })
    const rules = generateMockRules([a, b])
    expect(rules.length).toBe(2)
  })
})

describe('generateMockRules — skip-pending', () => {
  test('skips a request with no status and no response body (still pending)', () => {
    const pending = makeRequest({ status: undefined, responseBody: undefined })
    const rules = generateMockRules([pending])
    expect(rules.length).toBe(0)
  })

  test('skips an errored request with no status', () => {
    const errored = makeRequest({ status: undefined, responseBody: undefined, error: 'Network request failed' })
    const rules = generateMockRules([errored])
    expect(rules.length).toBe(0)
  })

  test('keeps a request with a status but empty response body (e.g. 204)', () => {
    const noContent = makeRequest({ status: 204, responseBody: undefined })
    const rules = generateMockRules([noContent])
    expect(rules.length).toBe(1)
    expect(rules[0]?.response.status).toBe(204)
    expect(rules[0]?.response.body).toBe('')
  })

  test('keeps a request with no status but a captured response body', () => {
    // Defensive: some captures may have a body without a numeric status set.
    const req = makeRequest({ status: undefined, responseBody: '{"partial":true}' })
    const rules = generateMockRules([req])
    expect(rules.length).toBe(1)
    expect(rules[0]?.response.status).toBe(200) // falls back to 200 default
  })
})

describe('generateMockRules — pattern derivation (path+query, origin stripped)', () => {
  test('strips scheme+host, keeps path', () => {
    const req = makeRequest({ url: 'https://api.example.com/v1/orders/42' })
    const rules = generateMockRules([req])
    expect(rules[0]?.pattern).toBe('/v1/orders/42')
  })

  test('keeps the query string', () => {
    const req = makeRequest({ url: 'https://api.example.com/search?q=shoes&page=2' })
    const rules = generateMockRules([req])
    expect(rules[0]?.pattern).toBe('/search?q=shoes&page=2')
  })

  test('a rule generated from one host matches a request against a different host (documented cross-env intent)', () => {
    const req = makeRequest({ url: 'https://prod.example.com/v1/orders/42' })
    const rules = generateMockRules([req])
    expect(rules[0]?.pattern).not.toContain('prod.example.com')
    expect(rules[0]?.pattern).toBe('/v1/orders/42')
  })

  test('falls back gracefully on an unparseable URL', () => {
    const req = makeRequest({ url: '/relative/path?x=1' })
    const rules = generateMockRules([req])
    expect(rules[0]?.pattern).toBe('/relative/path?x=1')
  })
})

describe('generateMockRules — id minting with prefix', () => {
  test('mints sequential ids with the default prefix', () => {
    const rules = generateMockRules([
      makeRequest({ url: 'https://api.example.com/a' }),
      makeRequest({ url: 'https://api.example.com/b' }),
    ])
    expect(rules.map((r) => r.id).sort()).toEqual(['mock-1', 'mock-2'])
  })

  test('mints sequential ids with a custom prefix', () => {
    const rules = generateMockRules(
      [makeRequest({ url: 'https://api.example.com/a' }), makeRequest({ url: 'https://api.example.com/b' })],
      { idPrefix: 'mcp-gen' },
    )
    expect(rules.map((r) => r.id).sort()).toEqual(['mcp-gen-1', 'mcp-gen-2'])
  })
})

describe('generateMockRules — carried-over fields', () => {
  test('carries status, content-type header, response body, mode, enabled', () => {
    const req = makeRequest({
      url: 'https://api.example.com/users/1',
      method: 'POST',
      status: 201,
      responseHeaders: { 'Content-Type': 'application/json', 'x-request-id': 'abc' },
      responseBody: '{"id":1}',
    })
    const rules = generateMockRules([req])
    const rule = rules[0]!
    expect(rule.method).toBe('POST')
    expect(rule.mode).toBe('mock')
    expect(rule.enabled).toBe(true)
    expect(rule.response.status).toBe(201)
    expect(rule.response.body).toBe('{"id":1}')
    expect(rule.response.headers).toEqual({ 'content-type': 'application/json' })
  })

  test('omits headers entirely when no content-type was captured', () => {
    const req = makeRequest({ responseHeaders: { 'x-request-id': 'abc' } })
    const rules = generateMockRules([req])
    expect(rules[0]?.response.headers).toBeUndefined()
  })

  test('omits headers entirely when no responseHeaders were captured', () => {
    const req = makeRequest({ responseHeaders: undefined })
    const rules = generateMockRules([req])
    expect(rules[0]?.response.headers).toBeUndefined()
  })
})

describe('generateMockRules — empty input', () => {
  test('returns an empty array for no requests', () => {
    expect(generateMockRules([])).toEqual([])
  })
})
