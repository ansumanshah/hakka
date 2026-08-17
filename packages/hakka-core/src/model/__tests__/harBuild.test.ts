import { describe, expect, test } from 'bun:test'

import { buildHar, exportHarString } from '../har'
import type { NetworkRequest } from '../types'

// har.test.ts already covers requestToHarEntry's per-entry field mapping
// (timings, headersSize, bodySize, postData mimeType). This file covers what
// that one doesn't: the buildHar/exportHarString wiring (log envelope,
// multi-entry arrays, JSON serialization) and the status -> statusText table.
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'r1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    startTime: Date.now(),
    ...overrides,
  }
}

describe('buildHar — log envelope', () => {
  test('produces HAR 1.2 with the expected creator metadata', () => {
    const har = buildHar([makeRequest()])
    expect(har.log.version).toBe('1.2')
    // Platform-neutral creator — this exporter serves every consumer, not RN.
    expect(har.log.creator.name).toBe('hakka-core')
    expect(typeof har.log.creator.version).toBe('string')
  })

  test('an empty request array produces zero entries, not an error', () => {
    const har = buildHar([])
    expect(har.log.entries).toEqual([])
  })

  test('preserves request order and produces one entry per request', () => {
    const har = buildHar([
      makeRequest({ id: 'a', url: 'https://api.example.com/a' }),
      makeRequest({ id: 'b', url: 'https://api.example.com/b' }),
      makeRequest({ id: 'c', url: 'https://api.example.com/c' }),
    ])
    expect(har.log.entries).toHaveLength(3)
    expect(har.log.entries.map((e) => e.request.url)).toEqual([
      'https://api.example.com/a',
      'https://api.example.com/b',
      'https://api.example.com/c',
    ])
  })
})

describe('exportHarString — serialization', () => {
  test('produces valid, pretty-printed JSON matching buildHar', () => {
    const requests = [makeRequest({ id: 'x' })]
    const text = exportHarString(requests)
    // Pretty-printed with 2-space indent (JSON.stringify(..., null, 2)).
    expect(text).toContain('\n  ')
    const parsed = JSON.parse(text)
    expect(parsed).toEqual(buildHar(requests))
  })

  test('round-trips a multi-entry export', () => {
    const requests = [
      makeRequest({ id: 'a', method: 'POST', status: 201 }),
      makeRequest({ id: 'b', method: 'DELETE', status: 204 }),
    ]
    const parsed = JSON.parse(exportHarString(requests))
    expect(parsed.log.entries).toHaveLength(2)
    expect(parsed.log.entries[0].request.method).toBe('POST')
    expect(parsed.log.entries[1].request.method).toBe('DELETE')
  })
})

// status -> statusText mapping (requestToHarEntry -> getStatusText, private —
// exercised here through the public buildHar/exportHarString surface).
// Ten canonical codes across the 2xx/3xx/4xx/5xx ranges, plus the "unknown
// code" and "no status" fallbacks.
describe('HAR status -> statusText mapping', () => {
  test.each([
    [200, 'OK'],
    [201, 'Created'],
    [204, 'No Content'],
    [301, 'Moved Permanently'],
    [304, 'Not Modified'],
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [404, 'Not Found'],
    [429, 'Too Many Requests'],
    [500, 'Internal Server Error'],
  ] as const)('status %d maps to statusText %p', (status, statusText) => {
    const har = buildHar([makeRequest({ status })])
    expect(har.log.entries[0]!.response.statusText).toBe(statusText)
  })

  test('an unrecognized status code maps to an empty statusText', () => {
    const har = buildHar([makeRequest({ status: 999 })])
    expect(har.log.entries[0]!.response.statusText).toBe('')
  })

  test('a null status maps to status 0 and an empty statusText', () => {
    const har = buildHar([makeRequest({ status: null })])
    expect(har.log.entries[0]!.response.status).toBe(0)
    expect(har.log.entries[0]!.response.statusText).toBe('')
  })
})
