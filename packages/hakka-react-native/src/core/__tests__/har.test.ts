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
  it('returns HAR log with version 1.2', () => {
    const har = toHAR([makeRequest()])
    expect(har.log.version).toBe('1.2')
  })

  it('includes creator name', () => {
    const har = toHAR([makeRequest()])
    expect(har.log.creator.name).toBeDefined()
    expect(typeof har.log.creator.name).toBe('string')
  })

  it('returns correct entry count for 2 requests', () => {
    const requests = [makeRequest({ id: 'req_1' }), makeRequest({ id: 'req_2', url: 'https://api.example.com/posts' })]
    const har = toHAR(requests)
    expect(har.log.entries).toHaveLength(2)
  })

  it('maps request method and url correctly', () => {
    const har = toHAR([makeRequest({ method: 'POST', url: 'https://api.example.com/create' })])
    const entry = har.log.entries[0]!
    expect(entry.request.method).toBe('POST')
    expect(entry.request.url).toBe('https://api.example.com/create')
  })

  it('maps response status correctly', () => {
    const har = toHAR([makeRequest({ status: 404 })])
    expect(har.log.entries[0]!.response.status).toBe(404)
  })

  it('sets timings.send to 0', () => {
    const har = toHAR([makeRequest()])
    expect(har.log.entries[0]!.timings.send).toBe(0)
  })

  it('sets time equal to duration', () => {
    const har = toHAR([makeRequest({ duration: 300 })])
    expect(har.log.entries[0]!.time).toBe(300)
  })

  it('converts request headers to [{name,value}] format', () => {
    const har = toHAR([makeRequest({ requestHeaders: { accept: 'application/json' } })])
    const headers = har.log.entries[0]!.request.headers
    expect(Array.isArray(headers)).toBe(true)
    expect(headers).toContainEqual({ name: 'accept', value: 'application/json' })
  })

  it('converts response headers to [{name,value}] format', () => {
    const har = toHAR([makeRequest({ responseHeaders: { 'content-type': 'application/json' } })])
    const headers = har.log.entries[0]!.response.headers
    expect(Array.isArray(headers)).toBe(true)
    expect(headers).toContainEqual({ name: 'content-type', value: 'application/json' })
  })

  it('includes response body in content.text', () => {
    const har = toHAR([makeRequest({ responseBody: '{"ok":true}' })])
    expect(har.log.entries[0]!.response.content.text).toBe('{"ok":true}')
  })

  it('returns empty entries for empty input', () => {
    const har = toHAR([])
    expect(har.log.entries).toHaveLength(0)
  })

  it('includes postData for POST requests with body', () => {
    const har = toHAR([
      makeRequest({
        method: 'POST',
        requestBody: '{"name":"test"}',
        requestHeaders: { 'content-type': 'application/json' },
      }),
    ])
    const entry = har.log.entries[0]!
    expect(entry.request.postData).toBeDefined()
    expect(entry.request.postData!.text).toBe('{"name":"test"}')
  })
})
