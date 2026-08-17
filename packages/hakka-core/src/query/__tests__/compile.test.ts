import { describe, expect, it } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { compileQuery } from '../compile'
import type { AdvancedQuery } from '../types'

function req(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'r1',
    url: 'https://api.example.com/v1/users',
    method: 'GET',
    status: 200,
    startTime: 1000,
    requestHeaders: { 'Content-Type': 'application/json', Authorization: 'Bearer token123' },
    responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
    requestBody: '{"query":"hello"}',
    responseBody: '{"users":[{"id":1}]}',
    requestBodySize: 17,
    responseBodySize: 20,
    runtime: 'client',
    ...overrides,
  }
}

function compile(q: AdvancedQuery) {
  return compileQuery(q)
}

describe('compileQuery — empty query', () => {
  it('matches everything when query is empty', () => {
    const match = compile({})
    expect(match(req())).toBe(true)
  })
})

describe('compileQuery — tokens', () => {
  it('substring in url (scope=all)', () => {
    const match = compile({ tokens: [{ scope: 'all', mode: 'substring', value: 'users', negate: false }] })
    expect(match(req({ url: 'https://api.example.com/users', requestBody: null, responseBody: null }))).toBe(true)
    expect(match(req({ url: 'https://api.example.com/orders', requestBody: null, responseBody: null }))).toBe(false)
  })

  it('url scope — only searches URL', () => {
    const match = compile({ tokens: [{ scope: 'url', mode: 'substring', value: 'users', negate: false }] })
    expect(match(req({ url: 'https://api.example.com/users', responseBody: 'other' }))).toBe(true)
    // "users" in body but not URL
    expect(match(req({ url: 'https://api.example.com/orders', responseBody: 'users' }))).toBe(false)
  })

  it('header scope — searches request + response header keys/values', () => {
    const match = compile({ tokens: [{ scope: 'header', mode: 'substring', value: 'bearer', negate: false }] })
    expect(match(req({ requestHeaders: { Authorization: 'Bearer abc' } }))).toBe(true)
    expect(match(req({ requestHeaders: {}, responseHeaders: {} }))).toBe(false)
  })

  it('body scope — searches requestBody and responseBody', () => {
    const match = compile({ tokens: [{ scope: 'body', mode: 'substring', value: 'query', negate: false }] })
    expect(match(req({ requestBody: '{"query":"test"}' }))).toBe(true)
    expect(match(req({ requestBody: null, responseBody: null }))).toBe(false)
  })

  it('negation — excludes matches', () => {
    const match = compile({ tokens: [{ scope: 'all', mode: 'substring', value: 'health', negate: true }] })
    expect(match(req({ url: 'https://api.example.com/health' }))).toBe(false)
    expect(match(req({ url: 'https://api.example.com/users' }))).toBe(true)
  })

  it('regex mode', () => {
    const match = compile({ tokens: [{ scope: 'url', mode: 'regex', value: '/v[0-9]+/', negate: false }] })
    expect(match(req({ url: 'https://api.example.com/v1/users' }))).toBe(true)
    expect(match(req({ url: 'https://api.example.com/beta/users' }))).toBe(false)
  })

  it('regex mode — invalid regex never matches', () => {
    const match = compile({ tokens: [{ scope: 'all', mode: 'regex', value: '[invalid', negate: false }] })
    expect(match(req())).toBe(false)
  })

  it('wildcard mode with *', () => {
    const match = compile({ tokens: [{ scope: 'url', mode: 'wildcard', value: '*/users*', negate: false }] })
    expect(match(req({ url: 'https://api.example.com/users?page=1' }))).toBe(true)
    expect(match(req({ url: 'https://api.example.com/orders' }))).toBe(false)
  })

  it('wildcard mode with ?', () => {
    const match = compile({ tokens: [{ scope: 'url', mode: 'wildcard', value: '*/v?/*', negate: false }] })
    expect(match(req({ url: 'https://api.example.com/v1/users' }))).toBe(true)
    expect(match(req({ url: 'https://api.example.com/v12/users' }))).toBe(false)
  })

  it('multiple tokens — AND semantics', () => {
    const match = compile({
      tokens: [
        { scope: 'url', mode: 'substring', value: 'api', negate: false },
        { scope: 'url', mode: 'substring', value: 'users', negate: false },
      ],
    })
    expect(match(req({ url: 'https://api.example.com/users' }))).toBe(true)
    expect(match(req({ url: 'https://api.example.com/orders' }))).toBe(false)
  })

  it('mixed positive and negative tokens', () => {
    const match = compile({
      tokens: [
        { scope: 'url', mode: 'substring', value: 'api', negate: false },
        { scope: 'url', mode: 'substring', value: 'health', negate: true },
      ],
    })
    expect(match(req({ url: 'https://api.example.com/users' }))).toBe(true)
    expect(match(req({ url: 'https://api.example.com/health' }))).toBe(false)
  })

  it('case-insensitive substring', () => {
    const match = compile({ tokens: [{ scope: 'url', mode: 'substring', value: 'USERS', negate: false }] })
    expect(match(req({ url: 'https://api.example.com/users' }))).toBe(true)
  })
})

describe('compileQuery — statusDsl', () => {
  it('2xx matches 200-299', () => {
    const match = compile({ statusDsl: '2xx' })
    expect(match(req({ status: 200 }))).toBe(true)
    expect(match(req({ status: 201 }))).toBe(true)
    expect(match(req({ status: 299 }))).toBe(true)
    expect(match(req({ status: 300 }))).toBe(false)
    expect(match(req({ status: 199 }))).toBe(false)
  })

  it('>=400 matches 400-599', () => {
    const match = compile({ statusDsl: '>=400' })
    expect(match(req({ status: 400 }))).toBe(true)
    expect(match(req({ status: 404 }))).toBe(true)
    expect(match(req({ status: 200 }))).toBe(false)
  })

  it('null status → excluded when statusDsl set', () => {
    const match = compile({ statusDsl: '2xx' })
    expect(match(req({ status: undefined }))).toBe(false)
  })

  it('invalid DSL → passes all (null range means no filter)', () => {
    const match = compile({ statusDsl: 'garbage' })
    expect(match(req({ status: 404 }))).toBe(true)
  })

  it('exact code 404', () => {
    const match = compile({ statusDsl: '404' })
    expect(match(req({ status: 404 }))).toBe(true)
    expect(match(req({ status: 200 }))).toBe(false)
  })
})

describe('compileQuery — method', () => {
  it('filters by method (case-insensitive)', () => {
    const match = compile({ method: 'post' })
    expect(match(req({ method: 'POST' }))).toBe(true)
    expect(match(req({ method: 'GET' }))).toBe(false)
  })
})

describe('compileQuery — contentType', () => {
  it('matches substring of response content-type header', () => {
    const match = compile({ contentType: 'json' })
    expect(match(req({ responseHeaders: { 'content-type': 'application/json; charset=utf-8' } }))).toBe(true)
    expect(match(req({ responseHeaders: { 'content-type': 'text/html' } }))).toBe(false)
  })

  it('falls back to req.contentType', () => {
    const match = compile({ contentType: 'json' })
    expect(match(req({ responseHeaders: undefined, contentType: 'application/json' }))).toBe(true)
  })
})

describe('compileQuery — runtime', () => {
  it('filters by runtime', () => {
    const match = compile({ runtime: 'server' })
    expect(match(req({ runtime: 'server' }))).toBe(true)
    expect(match(req({ runtime: 'client' }))).toBe(false)
  })

  it('defaults missing runtime to client', () => {
    const match = compile({ runtime: 'client' })
    expect(match(req({ runtime: undefined }))).toBe(true)
  })
})

describe('compileQuery — durationMin/Max', () => {
  it('durationMin excludes requests below threshold', () => {
    const match = compile({ durationMin: 100 })
    expect(match(req({ duration: 100 }))).toBe(true)
    expect(match(req({ duration: 200 }))).toBe(true)
    expect(match(req({ duration: 99 }))).toBe(false)
  })

  it('durationMax excludes requests above threshold', () => {
    const match = compile({ durationMax: 500 })
    expect(match(req({ duration: 500 }))).toBe(true)
    expect(match(req({ duration: 499 }))).toBe(true)
    expect(match(req({ duration: 501 }))).toBe(false)
  })

  it('durationMin + durationMax inclusive range', () => {
    const match = compile({ durationMin: 100, durationMax: 500 })
    expect(match(req({ duration: 100 }))).toBe(true)
    expect(match(req({ duration: 300 }))).toBe(true)
    expect(match(req({ duration: 500 }))).toBe(true)
    expect(match(req({ duration: 99 }))).toBe(false)
    expect(match(req({ duration: 501 }))).toBe(false)
  })

  it('null/missing duration treated as 0 — excluded by durationMin > 0', () => {
    const match = compile({ durationMin: 1 })
    expect(match(req({ duration: null }))).toBe(false)
    expect(match(req({ duration: undefined }))).toBe(false)
  })

  it('null duration treated as 0 — passes durationMax filter', () => {
    const match = compile({ durationMax: 1000 })
    expect(match(req({ duration: null }))).toBe(true)
    expect(match(req({ duration: undefined }))).toBe(true)
  })
})

describe('compileQuery — sizeMin/Max', () => {
  it('sizeMin excludes requests below total body size threshold', () => {
    // fixture: requestBodySize=17, responseBodySize=20 → total=37
    const match = compile({ sizeMin: 37 })
    expect(match(req())).toBe(true)
    expect(match(req({ requestBodySize: 10, responseBodySize: 10 }))).toBe(false)
  })

  it('sizeMax excludes requests above total body size threshold', () => {
    const match = compile({ sizeMax: 36 })
    expect(match(req())).toBe(false) // total=37
    expect(match(req({ requestBodySize: 10, responseBodySize: 10 }))).toBe(true)
  })

  it('sizeMin + sizeMax inclusive range', () => {
    const match = compile({ sizeMin: 20, sizeMax: 50 })
    expect(match(req({ requestBodySize: 10, responseBodySize: 10 }))).toBe(true) // 20
    expect(match(req({ requestBodySize: 17, responseBodySize: 20 }))).toBe(true) // 37
    expect(match(req({ requestBodySize: 25, responseBodySize: 25 }))).toBe(true) // 50
    expect(match(req({ requestBodySize: 5, responseBodySize: 5 }))).toBe(false) // 10
    expect(match(req({ requestBodySize: 30, responseBodySize: 25 }))).toBe(false) // 55
  })

  it('missing body sizes default to 0', () => {
    const match = compile({ sizeMax: 100 })
    expect(match(req({ requestBodySize: undefined, responseBodySize: undefined }))).toBe(true)
  })

  it('sizeMin > 0 excludes requests with no body', () => {
    const match = compile({ sizeMin: 1 })
    expect(match(req({ requestBodySize: undefined, responseBodySize: undefined }))).toBe(false)
  })
})

describe('compileQuery — combined filters (AND)', () => {
  it('token + durationMin + sizeMax all required', () => {
    const match = compile({
      tokens: [{ scope: 'url', mode: 'substring', value: 'users', negate: false }],
      durationMin: 50,
      sizeMax: 100,
    })
    // All match: url has "users", duration=100>=50, size=17+20=37<=100
    expect(match(req({ url: 'https://api.example.com/users', duration: 100 }))).toBe(true)
    // Wrong url
    expect(match(req({ url: 'https://api.example.com/orders', duration: 100 }))).toBe(false)
    // Duration too low
    expect(match(req({ url: 'https://api.example.com/users', duration: 49 }))).toBe(false)
    // Size too large
    expect(
      match(req({ url: 'https://api.example.com/users', duration: 100, requestBodySize: 60, responseBodySize: 60 })),
    ).toBe(false)
  })

  it('method + statusDsl + token all required', () => {
    const match = compile({
      method: 'GET',
      statusDsl: '2xx',
      tokens: [{ scope: 'url', mode: 'substring', value: 'users', negate: false }],
    })
    // All match
    expect(match(req({ method: 'GET', status: 200, url: 'https://api.example.com/users' }))).toBe(true)
    // Wrong method
    expect(match(req({ method: 'POST', status: 200, url: 'https://api.example.com/users' }))).toBe(false)
    // Wrong status
    expect(match(req({ method: 'GET', status: 404, url: 'https://api.example.com/users' }))).toBe(false)
    // Wrong URL
    expect(match(req({ method: 'GET', status: 200, url: 'https://api.example.com/orders' }))).toBe(false)
  })
})
