import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { toPlaywrightRoutes } from '../playwright'

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

describe('toPlaywrightRoutes — basic shape', () => {
  test('emits the Page import, exported function, and a page.route block for a GET with headers', () => {
    const src = toPlaywrightRoutes([makeRequest()])
    expect(src).toContain(`import type { Page } from '@playwright/test'`)
    expect(src).toContain('export async function mockRoutes(page: Page) {')
    expect(src).toContain(`await page.route('https://api.example.com/v1/users', async (route) => {`)
    expect(src).toContain(`if (route.request().method() !== 'GET') return route.fallback()`)
    expect(src).toContain('status: 200,')
    expect(src).toContain(`headers: { 'content-type': 'application/json' },`)
    expect(src).toContain('json: {"ok":true},')
  })

  test('respects a custom exportName', () => {
    const src = toPlaywrightRoutes([makeRequest()], { exportName: 'installMocks' })
    expect(src).toContain('export async function installMocks(page: Page) {')
  })

  test('drops the query string from the route URL', () => {
    const src = toPlaywrightRoutes([makeRequest({ url: 'https://api.example.com/v1/users?page=2&limit=10' })])
    expect(src).toContain(`await page.route('https://api.example.com/v1/users', `)
    expect(src).not.toContain('page=2')
  })

  test('skips requests with no usable response (no status, no body)', () => {
    const src = toPlaywrightRoutes([makeRequest({ status: undefined, responseBody: null })])
    expect(src).not.toContain('page.route(')
  })

  test('emits a POST with a JSON body via the json field, guarded by method', () => {
    const src = toPlaywrightRoutes([
      makeRequest({
        method: 'POST',
        url: 'https://api.example.com/v1/orders',
        status: 201,
        responseBody: JSON.stringify({ id: 42, item: 'noodles' }),
      }),
    ])
    expect(src).toContain(`await page.route('https://api.example.com/v1/orders', async (route) => {`)
    expect(src).toContain(`if (route.request().method() !== 'POST') return route.fallback()`)
    expect(src).toContain('status: 201,')
    expect(src).toContain('json: {"id":42,"item":"noodles"},')
  })

  test('uses the body field for a non-JSON response', () => {
    const src = toPlaywrightRoutes([makeRequest({ responseBody: 'plain text ok', responseHeaders: undefined })])
    expect(src).toContain(`body: 'plain text ok',`)
  })

  test('uses json: null when there is no body', () => {
    const src = toPlaywrightRoutes([makeRequest({ responseBody: null, status: 204, responseHeaders: undefined })])
    expect(src).toContain('status: 204,')
    expect(src).toContain('json: null,')
  })

  test('groups routes by origin with a comment header, sorted', () => {
    const src = toPlaywrightRoutes([
      makeRequest({ url: 'https://b.example.com/x', startTime: 1 }),
      makeRequest({ url: 'https://a.example.com/y', startTime: 2 }),
    ])
    const aIdx = src.indexOf('// https://a.example.com')
    const bIdx = src.indexOf('// https://b.example.com')
    expect(aIdx).toBeGreaterThan(-1)
    expect(bIdx).toBeGreaterThan(-1)
    expect(aIdx).toBeLessThan(bIdx)
  })

  test('multiple requests each produce their own page.route block', () => {
    const src = toPlaywrightRoutes([
      makeRequest({ url: 'https://api.example.com/v1/users', method: 'GET' }),
      makeRequest({ url: 'https://api.example.com/v1/orders', method: 'POST', status: 201 }),
      makeRequest({ url: 'https://other.example.com/ping', method: 'GET', status: 204, responseBody: null }),
    ])
    const occurrences = src.split('await page.route(').length - 1
    expect(occurrences).toBe(3)
    expect(src).toContain(`await page.route('https://api.example.com/v1/users', `)
    expect(src).toContain(`await page.route('https://api.example.com/v1/orders', `)
    expect(src).toContain(`await page.route('https://other.example.com/ping', `)
  })
})

describe('toPlaywrightRoutes — escaping', () => {
  test('a body containing backticks and ${} embeds safely inside a single-quoted string', () => {
    const src = toPlaywrightRoutes([
      makeRequest({
        responseBody: 'template `literal` with ${interpolation} inside',
        responseHeaders: undefined,
      }),
    ])
    expect(src).toContain("body: 'template `literal` with ${interpolation} inside',")
    // Never emitted as a template literal — backticks/`${` must not become live JS syntax.
    expect(src).not.toMatch(/body: `/)
    // An unescaped inner quote or a wrong backslash count would desync the string boundary and corrupt every line after it.
    expect(src.split('await page.route(').length - 1).toBe(1)
  })

  test('a single-quote, backslash, and newline in the body all escape correctly', () => {
    const src = toPlaywrightRoutes([
      makeRequest({
        responseBody: `it's a "quote" \\ and\nnewline`,
        responseHeaders: undefined,
      }),
    ])
    expect(src).toContain(`body: 'it\\'s a "quote" \\\\ and\\nnewline',`)
    expect(src.split('await page.route(').length - 1).toBe(1)
  })
})

describe('toPlaywrightRoutes — redacted headers', () => {
  test('an already-redacted header value is carried over verbatim, never a real secret', () => {
    const src = toPlaywrightRoutes([
      makeRequest({
        responseHeaders: {
          'content-type': 'application/json',
          authorization: '[REDACTED]',
        },
      }),
    ])
    expect(src).toContain(`'authorization': '[REDACTED]'`)
  })

  test('carries over response headers, dropping content-length/content-encoding/transfer-encoding', () => {
    const src = toPlaywrightRoutes([
      makeRequest({
        responseHeaders: {
          'content-type': 'application/json',
          'x-request-id': 'abc123',
          'content-length': '9999',
          'content-encoding': 'gzip',
        },
      }),
    ])
    expect(src).toContain(`'x-request-id': 'abc123'`)
    expect(src).toContain(`'content-type': 'application/json'`)
    expect(src).not.toContain('content-length')
    expect(src).not.toContain('content-encoding')
  })
})

describe('toPlaywrightRoutes — relative URLs', () => {
  test('excludes a relative-URL request from the routes', () => {
    const src = toPlaywrightRoutes([makeRequest({ url: '/v1/users' })])
    expect(src).not.toContain('(relative)')
    expect(src).not.toContain('page.route(')
  })

  test('emits a single skip-count comment for relative-URL requests', () => {
    const src = toPlaywrightRoutes([
      makeRequest({ url: '/v1/users' }),
      makeRequest({ url: '/v1/posts' }),
      makeRequest({ url: 'https://api.example.com/v1/health', responseBody: 'ok' }),
    ])
    expect(src).toContain('// skipped 2 request(s) with relative URLs')
    expect(src).toContain(`await page.route('https://api.example.com/v1/health', `)
  })
})

describe('toPlaywrightRoutes — dedup', () => {
  test('two requests with the same method+pathname collapse into one route, newest wins', () => {
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
    const src = toPlaywrightRoutes([older, newer])
    const occurrences = src.split('await page.route(').length - 1
    expect(occurrences).toBe(1)
    expect(src).toContain('"name":"new"')
    expect(src).not.toContain('"name":"old"')
  })

  test('same pathname but different methods both survive as separate guarded routes', () => {
    const getReq = makeRequest({ method: 'GET', url: 'https://api.example.com/v1/users' })
    const postReq = makeRequest({ method: 'POST', url: 'https://api.example.com/v1/users', status: 201 })
    const src = toPlaywrightRoutes([getReq, postReq])
    const occurrences = src.split('await page.route(').length - 1
    expect(occurrences).toBe(2)
    expect(src).toContain(`if (route.request().method() !== 'GET') return route.fallback()`)
    expect(src).toContain(`if (route.request().method() !== 'POST') return route.fallback()`)
  })
})

describe('toPlaywrightRoutes — truncation', () => {
  test('a response body over the byte threshold is truncated with a comment', () => {
    const bigBody = 'x'.repeat(200)
    const src = toPlaywrightRoutes([makeRequest({ responseBody: bigBody, responseHeaders: undefined })], {
      maxBodyBytes: 100,
    })
    expect(src).toContain('// truncated: original body 200 bytes, showing first 100')
    expect(src).toContain(`body: '${'x'.repeat(100)}',`)
  })

  test('a JSON body over the threshold falls back to the string form rather than emitting invalid syntax', () => {
    const bigJson = JSON.stringify({ items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: 'item'.repeat(5) })) })
    const src = toPlaywrightRoutes([makeRequest({ responseBody: bigJson })], { maxBodyBytes: 50 })
    expect(src).toContain('// truncated')
    expect(src).toContain('body: ')
    expect(src).not.toContain('json: {')
  })

  test('a body at or under the threshold is not truncated', () => {
    const body = 'x'.repeat(100)
    const src = toPlaywrightRoutes([makeRequest({ responseBody: body, responseHeaders: undefined })], {
      maxBodyBytes: 100,
    })
    expect(src).not.toContain('truncated')
  })
})
