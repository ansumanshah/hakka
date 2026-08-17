import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildAxios } from '../buildAxios'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'test-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    startTime: 0,
    ...overrides,
  }
}

describe('buildAxios', () => {
  test('emits method, url, and a header', () => {
    const snippet = buildAxios(
      makeRequest({
        method: 'PUT',
        requestHeaders: { Accept: 'application/json' },
      }),
    )
    expect(snippet).toContain('axios(')
    expect(snippet).toContain("method: 'put'")
    expect(snippet).toContain('https://api.example.com/v1/items')
    expect(snippet).toContain('Accept')
  })

  test('inlines JSON-looking body as an object literal', () => {
    const snippet = buildAxios(makeRequest({ method: 'POST', requestBody: '{"a":1}' }))
    expect(snippet).toContain('data: {"a":1},')
  })

  test('quotes a non-JSON body as a string', () => {
    const snippet = buildAxios(makeRequest({ method: 'POST', requestBody: 'plain text body' }))
    expect(snippet).toContain("data: 'plain text body'")
  })
})
