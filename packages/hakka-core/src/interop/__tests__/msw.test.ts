import { describe, expect, test, beforeEach } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildMswHandlers, parseMswHandlers } from '../msw'

// Uses a fresh import per describe (query-param versioning) so mockEngine's singleton state doesn't leak across tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockEngineModule = any

let idSeq = 0
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idSeq++
  return {
    id: `req-${idSeq}`,
    url: 'https://api.example.com/v1/users',
    method: 'GET',
    status: 200,
    startTime: idSeq,
    responseBody: '{"ok":true}',
    responseHeaders: { 'content-type': 'application/json' },
    ...overrides,
  }
}

describe('buildMswHandlers — basic shape', () => {
  test('emits the msw import, export array, and a concise-arrow handler', () => {
    const src = buildMswHandlers([makeRequest()])
    expect(src).toContain(`import { http, HttpResponse } from 'msw'`)
    expect(src).toContain('export const handlers = [')
    expect(src).toContain(`http.get('https://api.example.com/v1/users', () => HttpResponse.json(`)
    expect(src).toContain('"ok":true')
    expect(src).toContain('status: 200')
  })

  test('respects a custom exportName', () => {
    const src = buildMswHandlers([makeRequest()], { exportName: 'myHandlers' })
    expect(src).toContain('export const myHandlers = [')
  })

  test('drops the query string from the handler predicate (MSW matches origin+pathname only)', () => {
    const src = buildMswHandlers([makeRequest({ url: 'https://api.example.com/v1/users?page=2&limit=10' })])
    expect(src).toContain(`http.get('https://api.example.com/v1/users', `)
    expect(src).not.toContain('page=2')
  })

  test('skips requests with no usable response (no status, no body)', () => {
    const src = buildMswHandlers([makeRequest({ status: undefined, responseBody: null })])
    expect(src).not.toContain('http.get(')
  })

  test('uses HttpResponse.text for a non-JSON body', () => {
    const src = buildMswHandlers([makeRequest({ responseBody: 'plain text ok', responseHeaders: undefined })])
    expect(src).toContain(`HttpResponse.text('plain text ok'`)
  })

  test('uses HttpResponse.json(null, ...) when there is no body', () => {
    const src = buildMswHandlers([makeRequest({ responseBody: null, status: 204, responseHeaders: undefined })])
    expect(src).toContain('HttpResponse.json(null, { status: 204 })')
  })

  test('carries over response headers, dropping content-length/content-encoding/transfer-encoding', () => {
    const src = buildMswHandlers([
      makeRequest({
        responseHeaders: {
          'content-type': 'application/json',
          'x-request-id': 'abc123',
          'content-length': '9999',
          'content-encoding': 'gzip',
        },
      }),
    ])
    expect(src).toContain("'x-request-id': 'abc123'")
    expect(src).toContain("'content-type': 'application/json'")
    expect(src).not.toContain('content-length')
    expect(src).not.toContain('content-encoding')
  })

  test('groups handlers by origin with a comment header, sorted', () => {
    const src = buildMswHandlers([
      makeRequest({ url: 'https://b.example.com/x', startTime: 1 }),
      makeRequest({ url: 'https://a.example.com/y', startTime: 2 }),
    ])
    const aIdx = src.indexOf('// https://a.example.com')
    const bIdx = src.indexOf('// https://b.example.com')
    expect(aIdx).toBeGreaterThan(-1)
    expect(bIdx).toBeGreaterThan(-1)
    expect(aIdx).toBeLessThan(bIdx)
  })
})

describe('buildMswHandlers — relative URLs', () => {
  // A request whose URL isn't parseable as absolute (no scheme/host) must be excluded, not emitted as a handler with a literal '(relative)' origin that can never match a real request.
  test('excludes a relative-URL request from the handlers array', () => {
    const src = buildMswHandlers([makeRequest({ url: '/v1/users' })])
    expect(src).not.toContain('(relative)')
    expect(src).not.toContain('http.get(')
  })

  test('emits a single skip-count comment for relative-URL requests', () => {
    const src = buildMswHandlers([
      makeRequest({ url: '/v1/users' }),
      makeRequest({ url: '/v1/posts' }),
      makeRequest({ url: 'https://api.example.com/v1/health', responseBody: 'ok' }),
    ])
    expect(src).toContain('// skipped 2 request(s) with relative URLs')
    expect(src).toContain(`http.get('https://api.example.com/v1/health', `)
  })

  test('emits no skip comment when every request is absolute', () => {
    const src = buildMswHandlers([makeRequest({ url: 'https://api.example.com/v1/users' })])
    expect(src).not.toContain('skipped')
  })

  test('emits no skip comment when the relative request is unusable (no status, no body)', () => {
    const src = buildMswHandlers([makeRequest({ url: '/v1/users', status: undefined, responseBody: null })])
    expect(src).not.toContain('skipped')
  })
})

describe('buildMswHandlers — dedup', () => {
  test('two requests with the same method+pathname collapse into one handler, newest wins', () => {
    const older = makeRequest({
      url: 'https://api.example.com/v1/users',
      startTime: 1,
      responseBody: '{"name":"old"}',
    })
    const newer = makeRequest({
      url: 'https://api.example.com/v1/users?refresh=1',
      startTime: 2,
      responseBody: '{"name":"new"}',
    })
    const src = buildMswHandlers([older, newer])
    const occurrences = src.split('http.get(').length - 1
    expect(occurrences).toBe(1)
    expect(src).toContain('"name":"new"')
    expect(src).not.toContain('"name":"old"')
  })

  test('same pathname but different methods both survive', () => {
    const getReq = makeRequest({ method: 'GET', url: 'https://api.example.com/v1/users' })
    const postReq = makeRequest({ method: 'POST', url: 'https://api.example.com/v1/users', status: 201 })
    const src = buildMswHandlers([getReq, postReq])
    expect(src).toContain('http.get(')
    expect(src).toContain('http.post(')
  })
})

describe('buildMswHandlers — truncation', () => {
  test('a response body over the byte threshold is truncated with a comment', () => {
    const bigBody = 'x'.repeat(200)
    const src = buildMswHandlers([makeRequest({ responseBody: bigBody, responseHeaders: undefined })], {
      maxBodyBytes: 100,
    })
    expect(src).toContain('// truncated: original body 200 bytes, showing first 100')
    expect(src).toContain(`HttpResponse.text('${'x'.repeat(100)}'`)
  })

  test('a JSON body over the threshold falls back to .text() rather than emitting invalid syntax', () => {
    const bigJson = JSON.stringify({ items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: 'item'.repeat(5) })) })
    const src = buildMswHandlers([makeRequest({ responseBody: bigJson })], { maxBodyBytes: 50 })
    expect(src).toContain('// truncated')
    expect(src).toContain('HttpResponse.text(')
    // Must still be syntactically parseable back out (round-trip degrades gracefully, doesn't throw).
    expect(() => parseMswHandlers(src)).not.toThrow()
  })

  test('a body at or under the threshold is not truncated', () => {
    const body = 'x'.repeat(100)
    const src = buildMswHandlers([makeRequest({ responseBody: body, responseHeaders: undefined })], {
      maxBodyBytes: 100,
    })
    expect(src).not.toContain('truncated')
  })
})

describe('parseMswHandlers — supported subset', () => {
  test('parses a concise-arrow http.get + HttpResponse.json handler', () => {
    const src = `
      import { http, HttpResponse } from 'msw'
      export const handlers = [
        http.get('https://api.example.com/v1/users', () => HttpResponse.json({ ok: true }, { status: 200 })),
      ]
    `
    const { rules, unsupported } = parseMswHandlers(src)
    expect(unsupported).toEqual([])
    expect(rules).toHaveLength(1)
    expect(rules[0]?.pattern).toBe('https://api.example.com/v1/users')
    expect(rules[0]?.method).toBe('GET')
    expect(rules[0]?.response.status).toBe(200)
    expect(rules[0]?.response.body).toEqual({ ok: true })
    expect(rules[0]?.enabled).toBe(true)
    expect(rules[0]?.hitCount).toBe(0)
  })

  test('parses HttpResponse.text with headers', () => {
    const src = `http.post('/api/echo', () => HttpResponse.text('hello world', { status: 201, headers: { 'x-a': '1' } }))`
    const { rules, unsupported } = parseMswHandlers(src)
    expect(unsupported).toEqual([])
    expect(rules).toHaveLength(1)
    expect(rules[0]?.method).toBe('POST')
    expect(rules[0]?.response.status).toBe(201)
    expect(rules[0]?.response.body).toBe('hello world')
    expect(rules[0]?.response.headers).toEqual({ 'x-a': '1' })
  })

  test('parses a single-return block-body resolver the same as a concise arrow', () => {
    const src = `http.get('/api/data', () => { return HttpResponse.json({ a: 1 }, { status: 200 }) })`
    const { rules, unsupported } = parseMswHandlers(src)
    expect(unsupported).toEqual([])
    expect(rules[0]?.response.body).toEqual({ a: 1 })
  })

  test('defaults to status 200 when no init object is given', () => {
    const src = `http.get('/api/data', () => HttpResponse.json({ a: 1 }))`
    const { rules } = parseMswHandlers(src)
    expect(rules[0]?.response.status).toBe(200)
  })

  test('http.all maps to a rule with no method filter', () => {
    const src = `http.all('/api/any', () => HttpResponse.json(null, { status: 200 }))`
    const { rules, unsupported } = parseMswHandlers(src)
    expect(unsupported).toEqual([])
    expect(rules[0]?.method).toBeUndefined()
  })

  test('parses multiple handlers in one source, mixing supported and unsupported', () => {
    const src = `
      export const handlers = [
        http.get('/a', () => HttpResponse.json({ x: 1 })),
        http.get('/b', ({ request }) => HttpResponse.json({ url: request.url })),
        http.post('/c', () => HttpResponse.text('ok', { status: 200 })),
      ]
    `
    const { rules, unsupported } = parseMswHandlers(src)
    expect(rules).toHaveLength(2)
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]?.path).toBe('/b')
  })
})

describe('parseMswHandlers — unsupported-resolver reporting', () => {
  test('a resolver that reads request params is reported, not dropped silently', () => {
    const src = `http.get('/api/users/:id', ({ params }) => HttpResponse.json({ id: params.id }))`
    const { rules, unsupported } = parseMswHandlers(src)
    expect(rules).toEqual([])
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]?.method).toBe('GET')
    expect(unsupported[0]?.path).toBe('/api/users/:id')
    expect(unsupported[0]?.reason).toContain('unsupported: dynamic resolver')
  })

  test('a multi-statement block resolver is reported', () => {
    const src = `http.get('/api/data', () => {
      const extra = computeSomething()
      return HttpResponse.json({ extra })
    })`
    const { rules, unsupported } = parseMswHandlers(src)
    expect(rules).toEqual([])
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]?.reason).toContain('unsupported: dynamic resolver')
  })

  test('a non-literal body (variable reference) is reported', () => {
    const src = `
      const fixture = { a: 1 }
      http.get('/api/data', () => HttpResponse.json(fixture))
    `
    const { rules, unsupported } = parseMswHandlers(src)
    expect(rules).toEqual([])
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]?.reason).toContain('unsupported: dynamic resolver')
  })

  test('a resolver calling a helper function (not HttpResponse directly) is reported', () => {
    const src = `http.get('/api/data', () => makeResponse(200))`
    const { rules, unsupported } = parseMswHandlers(src)
    expect(rules).toEqual([])
    expect(unsupported[0]?.reason).toContain('unsupported: dynamic resolver')
  })

  test('a passthrough() resolver is reported rather than crashing the scanner', () => {
    const src = `http.get('/api/passthrough', () => passthrough())`
    const { rules, unsupported } = parseMswHandlers(src)
    expect(rules).toEqual([])
    expect(unsupported).toHaveLength(1)
  })
})

describe('round trip — capture-shaped fixtures through buildMswHandlers + parseMswHandlers', () => {
  let mockEngine: MockEngineModule

  beforeEach(async () => {
    const mod = await import('../../engine/MockEngine?v=msw-roundtrip-' + Math.random())
    mockEngine = mod.mockEngine
  })

  test('every winning capture matches its own rule end to end via mockEngine.match', () => {
    const fixtures: NetworkRequest[] = [
      makeRequest({
        url: 'https://api.example.com/v1/users',
        method: 'GET',
        status: 200,
        startTime: 1,
        responseBody: JSON.stringify({ users: [{ id: 1, name: 'Ada' }] }),
        responseHeaders: { 'content-type': 'application/json' },
      }),
      makeRequest({
        url: 'https://api.example.com/v1/users',
        method: 'POST',
        status: 201,
        startTime: 2,
        responseBody: JSON.stringify({ id: 2, name: 'Grace' }),
        responseHeaders: { 'content-type': 'application/json' },
      }),
      makeRequest({
        url: 'https://api.example.com/v1/health',
        method: 'GET',
        status: 200,
        startTime: 3,
        responseBody: 'ok',
        responseHeaders: { 'content-type': 'text/plain' },
      }),
      makeRequest({
        url: 'https://other.example.com/ping',
        method: 'GET',
        status: 204,
        startTime: 4,
        responseBody: null,
      }),
    ]

    const source = buildMswHandlers(fixtures)
    const { rules, unsupported } = parseMswHandlers(source)

    expect(unsupported).toEqual([])
    expect(rules).toHaveLength(fixtures.length)

    for (const rule of rules) mockEngine.addRule(rule)

    for (const fixture of fixtures) {
      const matched = mockEngine.match(fixture.url, fixture.method)
      expect(matched).not.toBeNull()
      expect(matched!.response.status).toBe(fixture.status)
    }

    const usersMatch = mockEngine.match('https://api.example.com/v1/users', 'GET')
    expect(usersMatch!.response.body).toEqual({ users: [{ id: 1, name: 'Ada' }] })

    const healthMatch = mockEngine.match('https://api.example.com/v1/health', 'GET')
    expect(healthMatch!.response.body).toBe('ok')
  })

  test('a deduped-away request still matches the winning rule (same pathname), just with the newer body', () => {
    const older = makeRequest({
      url: 'https://api.example.com/v1/users?page=1',
      startTime: 1,
      responseBody: '{"page":1}',
    })
    const newer = makeRequest({
      url: 'https://api.example.com/v1/users?page=2',
      startTime: 2,
      responseBody: '{"page":2}',
    })

    const source = buildMswHandlers([older, newer])
    const { rules } = parseMswHandlers(source)
    expect(rules).toHaveLength(1)
    for (const rule of rules) mockEngine.addRule(rule)

    const matchedOlder = mockEngine.match(older.url, 'GET')
    const matchedNewer = mockEngine.match(newer.url, 'GET')
    expect(matchedOlder).not.toBeNull()
    expect(matchedNewer).not.toBeNull()
    expect(matchedOlder!.id).toBe(matchedNewer!.id)
    expect(matchedNewer!.response.body).toEqual({ page: 2 })
  })
})
