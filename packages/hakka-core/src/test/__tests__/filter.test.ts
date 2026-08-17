import { describe, test, expect } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { findRequest, filterRequests, matchesFilter } from '../filter'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: Math.random().toString(36).slice(2),
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    ...overrides,
  }
}

describe('matchesFilter', () => {
  test('empty filter matches everything', () => {
    const r = makeRequest()
    expect(matchesFilter(r, {})).toBe(true)
  })

  test('url substring match', () => {
    const r = makeRequest({ url: 'https://api.example.com/users/42' })
    expect(matchesFilter(r, { url: '/users' })).toBe(true)
    expect(matchesFilter(r, { url: '/posts' })).toBe(false)
  })

  test('method match is case-insensitive', () => {
    const r = makeRequest({ method: 'POST' })
    expect(matchesFilter(r, { method: 'post' })).toBe(true)
    expect(matchesFilter(r, { method: 'POST' })).toBe(true)
    expect(matchesFilter(r, { method: 'GET' })).toBe(false)
  })

  test('status match', () => {
    const r = makeRequest({ status: 404 })
    expect(matchesFilter(r, { status: 404 })).toBe(true)
    expect(matchesFilter(r, { status: 200 })).toBe(false)
  })

  test('mocked flag match', () => {
    const mocked = makeRequest({ mocked: true })
    const real = makeRequest({ mocked: undefined })
    expect(matchesFilter(mocked, { mocked: true })).toBe(true)
    expect(matchesFilter(real, { mocked: true })).toBe(false)
    expect(matchesFilter(real, { mocked: false })).toBe(true)
  })

  test('contentType from responseHeaders', () => {
    const r = makeRequest({ responseHeaders: { 'content-type': 'application/json' } })
    expect(matchesFilter(r, { contentType: 'json' })).toBe(true)
    expect(matchesFilter(r, { contentType: 'xml' })).toBe(false)
  })

  test('contentType from contentType field', () => {
    const r = makeRequest({ contentType: 'image/png' })
    expect(matchesFilter(r, { contentType: 'image' })).toBe(true)
  })

  test('multiple filter fields are ANDed', () => {
    const r = makeRequest({ method: 'POST', status: 201, url: 'https://api.example.com/posts' })
    expect(matchesFilter(r, { method: 'POST', status: 201, url: '/posts' })).toBe(true)
    expect(matchesFilter(r, { method: 'POST', status: 200, url: '/posts' })).toBe(false)
  })
})

describe('findRequest', () => {
  const logs: NetworkRequest[] = [
    makeRequest({ url: 'https://api.example.com/users', method: 'GET', status: 200 }),
    makeRequest({ url: 'https://api.example.com/posts', method: 'POST', status: 201 }),
    makeRequest({ url: 'https://api.example.com/auth/login', method: 'POST', status: 401 }),
  ]

  test('finds first matching request', () => {
    const r = findRequest(logs, { method: 'POST' })
    expect(r?.url).toContain('/posts')
  })

  test('returns undefined when nothing matches', () => {
    expect(findRequest(logs, { url: '/missing' })).toBeUndefined()
  })

  test('finds by url and status combined', () => {
    const r = findRequest(logs, { url: '/auth/login', status: 401 })
    expect(r).toBeDefined()
    expect(r!.status).toBe(401)
  })
})

describe('filterRequests', () => {
  const logs: NetworkRequest[] = [
    makeRequest({ url: 'https://api.example.com/users', method: 'GET', status: 200 }),
    makeRequest({ url: 'https://api.example.com/users/1', method: 'GET', status: 200 }),
    makeRequest({ url: 'https://api.example.com/posts', method: 'POST', status: 201 }),
  ]

  test('returns all matching requests', () => {
    const results = filterRequests(logs, { method: 'GET' })
    expect(results).toHaveLength(2)
  })

  test('returns empty array when nothing matches', () => {
    expect(filterRequests(logs, { status: 500 })).toHaveLength(0)
  })

  test('url filter narrows across multiple matching', () => {
    const results = filterRequests(logs, { url: '/users', method: 'GET' })
    expect(results).toHaveLength(2)
  })
})
