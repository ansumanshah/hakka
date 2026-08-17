import type { NetworkRequest } from 'hakka-core'
import { describe, expect, it } from 'vitest'

import { buildFetch, buildRequestText } from '../requestFormat'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'a',
    url: 'https://api.example.com/users',
    method: 'GET',
    startTime: 0,
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  } as NetworkRequest
}

describe('buildFetch', () => {
  it('emits a valid fetch() snippet with method', () => {
    const snippet = buildFetch(req({ method: 'GET' }))
    expect(snippet).toContain('fetch("https://api.example.com/users"')
    expect(snippet).toContain('"method": "GET"')
  })

  it('includes headers and body for a POST', () => {
    const snippet = buildFetch(
      req({ method: 'POST', requestHeaders: { 'content-type': 'application/json' }, requestBody: '{"a":1}' }),
    )
    expect(snippet).toContain('"method": "POST"')
    expect(snippet).toContain('content-type')
    expect(snippet).toContain('"body": "{\\"a\\":1}"')
  })
})

describe('buildRequestText', () => {
  it('includes method, url, status, headers, and bodies', () => {
    const text = buildRequestText(
      req({
        method: 'POST',
        status: 201,
        requestHeaders: { 'x-test': '1' },
        requestBody: 'reqbody',
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: 'resbody',
      }),
    )
    expect(text).toContain('POST https://api.example.com/users')
    expect(text).toContain('Status: 201')
    expect(text).toContain('— Request Headers —')
    expect(text).toContain('x-test: 1')
    expect(text).toContain('reqbody')
    expect(text).toContain('— Response Body —')
    expect(text).toContain('resbody')
  })

  it('surfaces GraphQL operation info', () => {
    const text = buildRequestText(req({ graphql: { operationType: 'query', operationName: 'GetUser' } }))
    expect(text).toContain('GraphQL: query GetUser')
  })
})
