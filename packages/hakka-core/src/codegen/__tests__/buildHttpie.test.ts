import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildHttpie } from '../buildHttpie'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'test-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    startTime: 0,
    ...overrides,
  }
}

describe('buildHttpie', () => {
  test('emits method, url, and a header', () => {
    const cmd = buildHttpie(
      makeRequest({
        method: 'DELETE',
        requestHeaders: { 'X-Api-Key': 'abc123' },
      }),
    )
    expect(cmd).toContain('http')
    expect(cmd).toContain('DELETE')
    expect(cmd).toContain("'https://api.example.com/v1/items'")
    expect(cmd).toContain("'X-Api-Key:abc123'")
  })

  test('shell-quotes a body with a single quote', () => {
    const cmd = buildHttpie(makeRequest({ method: 'POST', requestBody: "it's a body" }))
    expect(cmd).toContain('--raw')
    expect(cmd).toContain("it'\\''s a body")
  })
})
