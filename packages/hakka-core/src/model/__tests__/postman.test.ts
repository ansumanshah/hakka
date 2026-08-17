import { describe, it, expect } from 'bun:test'

import { requestToPostmanItem, buildPostmanCollection, exportPostmanString } from '../postman'
import type { NetworkRequest } from '../types'

const SCHEMA_URL = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

/** Minimal valid NetworkRequest fixture */
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/users',
    method: 'get',
    startTime: Date.now(),
    ...overrides,
  } as NetworkRequest
}

describe('requestToPostmanItem', () => {
  it('sets name to "METHOD path" with uppercase method', () => {
    const req = makeRequest({ method: 'get', url: 'https://api.example.com/users' })
    const item = requestToPostmanItem(req)
    expect(item.name).toBe('GET /users')
  })

  it('uppercases the method in the request object', () => {
    const req = makeRequest({ method: 'post' })
    const item = requestToPostmanItem(req)
    expect(item.request.method).toBe('POST')
  })

  it('preserves the full url in request.url', () => {
    const req = makeRequest({ url: 'https://api.example.com/v2/items?foo=bar' })
    const item = requestToPostmanItem(req)
    expect(item.request.url).toBe('https://api.example.com/v2/items?foo=bar')
  })

  it('converts requestHeaders record to header array', () => {
    const req = makeRequest({
      requestHeaders: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token123',
      },
    })
    const item = requestToPostmanItem(req)
    expect(item.request.header).toContainEqual({ key: 'Content-Type', value: 'application/json' })
    expect(item.request.header).toContainEqual({ key: 'Authorization', value: 'Bearer token123' })
    expect(item.request.header).toHaveLength(2)
  })

  it('produces empty header array when requestHeaders is undefined', () => {
    const req = makeRequest({ requestHeaders: undefined })
    const item = requestToPostmanItem(req)
    expect(item.request.header).toEqual([])
  })

  it('includes body with mode raw when requestBody is non-empty', () => {
    const req = makeRequest({ requestBody: '{"name":"Alice"}' })
    const item = requestToPostmanItem(req)
    expect(item.request.body).toEqual({ mode: 'raw', raw: '{"name":"Alice"}' })
  })

  it('omits body when requestBody is undefined', () => {
    const req = makeRequest({ requestBody: undefined })
    const item = requestToPostmanItem(req)
    expect(item.request.body).toBeUndefined()
  })

  it('omits body when requestBody is null', () => {
    const req = makeRequest({ requestBody: null })
    const item = requestToPostmanItem(req)
    expect(item.request.body).toBeUndefined()
  })

  it('omits body when requestBody is empty string', () => {
    const req = makeRequest({ requestBody: '' })
    const item = requestToPostmanItem(req)
    expect(item.request.body).toBeUndefined()
  })

  it('response is always an empty array', () => {
    const req = makeRequest()
    const item = requestToPostmanItem(req)
    expect(item.response).toEqual([])
  })

  it('handles non-URL string as path in name', () => {
    const req = makeRequest({ url: 'not-a-url', method: 'DELETE' })
    const item = requestToPostmanItem(req)
    // pathOf falls back to the raw url when URL parsing fails
    expect(item.name).toBe('DELETE not-a-url')
  })
})

describe('buildPostmanCollection', () => {
  it('uses "Hakka Export" as the default collection name', () => {
    const collection = buildPostmanCollection([])
    expect(collection.info.name).toBe('Hakka Export')
  })

  it('uses a custom name when provided via options', () => {
    const collection = buildPostmanCollection([], { name: 'My API' })
    expect(collection.info.name).toBe('My API')
  })

  it('includes the Postman Collection v2.1 schema URL', () => {
    const collection = buildPostmanCollection([])
    expect(collection.info.schema).toBe(SCHEMA_URL)
  })

  it('returns empty item array for empty input', () => {
    const collection = buildPostmanCollection([])
    expect(collection.item).toEqual([])
  })

  it('item count matches input request count', () => {
    const requests = [
      makeRequest({ id: '1', url: 'https://api.example.com/a', method: 'GET' }),
      makeRequest({ id: '2', url: 'https://api.example.com/b', method: 'POST' }),
      makeRequest({ id: '3', url: 'https://api.example.com/c', method: 'DELETE' }),
    ]
    const collection = buildPostmanCollection(requests)
    expect(collection.item).toHaveLength(3)
  })

  it('each item corresponds to the correct request', () => {
    const requests = [
      makeRequest({ id: '1', url: 'https://api.example.com/users', method: 'get' }),
      makeRequest({ id: '2', url: 'https://api.example.com/posts', method: 'post' }),
    ]
    const collection = buildPostmanCollection(requests)
    expect(collection.item[0].name).toBe('GET /users')
    expect(collection.item[1].name).toBe('POST /posts')
  })
})

describe('exportPostmanString', () => {
  it('produces valid JSON that round-trips through JSON.parse', () => {
    const requests = [makeRequest({ url: 'https://api.example.com/items', method: 'GET' })]
    const json = exportPostmanString(requests)
    const parsed = JSON.parse(json)
    expect(typeof parsed).toBe('object')
  })

  it('round-tripped output matches buildPostmanCollection', () => {
    const requests = [makeRequest({ url: 'https://api.example.com/users', method: 'GET', requestBody: undefined })]
    const parsed = JSON.parse(exportPostmanString(requests))
    const expected = buildPostmanCollection(requests)
    expect(parsed).toEqual(expected)
  })

  it('round-tripped output with custom name matches buildPostmanCollection', () => {
    const requests = [makeRequest({ url: 'https://api.example.com/items', method: 'POST', requestBody: '{}' })]
    const options = { name: 'Custom Collection' }
    const parsed = JSON.parse(exportPostmanString(requests, options))
    const expected = buildPostmanCollection(requests, options)
    expect(parsed).toEqual(expected)
  })

  it('output for empty input round-trips correctly', () => {
    const parsed = JSON.parse(exportPostmanString([]))
    const expected = buildPostmanCollection([])
    expect(parsed).toEqual(expected)
  })
})
