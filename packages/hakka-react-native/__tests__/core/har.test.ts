/**
 * Unit tests for src/core/har.ts — toHAR function
 */

import { buildHar as toHAR } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

const makeRequest = (overrides: Partial<NetworkRequest> = {}): NetworkRequest => ({
  id: 'req_1',
  url: 'https://api.example.com/users',
  method: 'GET',
  status: 200,
  startTime: 1700000000000,
  endTime: 1700000000250,
  timestamp: 1700000000000,
  duration: 250,
  requestHeaders: { accept: 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  responseBody: '{"users":[]}',
  size: 12,
  ...overrides,
})

describe('toHAR', () => {
  it('converts response headers to [{name,value}] format', () => {
    const har = toHAR([makeRequest({ responseHeaders: { 'content-type': 'application/json' } })])
    const headers = har.log.entries[0]!.response.headers
    expect(Array.isArray(headers)).toBe(true)
    expect(headers).toContainEqual({ name: 'content-type', value: 'application/json' })
  })
})
