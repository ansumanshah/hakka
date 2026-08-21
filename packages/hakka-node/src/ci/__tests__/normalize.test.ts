import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from 'hakka-core'

import { hostOf, normalizeRequestsForBaseline, pathOf, shapeOfBody, shapeOfJson, templatePath } from '../normalize'

function req(overrides: Partial<NetworkRequest>): NetworkRequest {
  return {
    id: overrides.id ?? 'r1',
    url: overrides.url ?? 'https://api.example.com/users',
    method: overrides.method ?? 'GET',
    startTime: 0,
    ...overrides,
  }
}

describe('templatePath', () => {
  test('templates numeric id segments', () => {
    expect(templatePath('/users/42')).toBe('/users/:id')
  })

  test('templates UUID segments', () => {
    expect(templatePath('/orders/8f14e45f-ceea-467e-adc1-0a2f7b3d1234')).toBe('/orders/:id')
  })

  test('templates Mongo ObjectId segments', () => {
    expect(templatePath('/posts/5f8d0d55b54764421b7156c3')).toBe('/posts/:id')
  })

  test('templates long opaque tokens containing a digit', () => {
    expect(templatePath('/sessions/a1b2c3d4e5f6g7h8')).toBe('/sessions/:id')
  })

  test('leaves static words alone', () => {
    expect(templatePath('/users/settings/profile')).toBe('/users/settings/profile')
  })

  test('leaves a slug with no digit alone (documented limitation)', () => {
    expect(templatePath('/posts/my-first-post')).toBe('/posts/my-first-post')
  })
})

describe('hostOf / pathOf', () => {
  test('hostOf ignores port', () => {
    expect(hostOf('http://localhost:54231/api/users')).toBe('localhost')
    expect(hostOf('http://localhost:9999/api/users')).toBe('localhost')
  })

  test('pathOf drops query string and templates ids', () => {
    expect(pathOf('https://api.example.com/users/42?foo=bar')).toBe('/users/:id')
  })

  test('both return safe defaults for unparsable urls', () => {
    expect(hostOf('not a url')).toBeNull()
    expect(pathOf('not a url')).toBe('/')
  })
})

describe('shapeOfJson', () => {
  test('captures key names and value types, not values', () => {
    const a = shapeOfJson({ name: 'alice', age: 30, active: true })
    const b = shapeOfJson({ name: 'bob', age: 99, active: false })
    expect(a).toBe(b)
  })

  test('changes when a key is added', () => {
    const a = shapeOfJson({ name: 'alice' })
    const b = shapeOfJson({ name: 'alice', apiKey: 'x' })
    expect(a).not.toBe(b)
  })

  test('changes when a value type changes', () => {
    const a = shapeOfJson({ count: 1 })
    const b = shapeOfJson({ count: '1' })
    expect(a).not.toBe(b)
  })

  test('is stable regardless of key order', () => {
    const a = shapeOfJson({ x: 1, y: 2 })
    const b = shapeOfJson({ y: 2, x: 1 })
    expect(a).toBe(b)
  })

  test('arrays sample the first element', () => {
    expect(shapeOfJson([{ a: 1 }, { a: 2 }])).toBe('array<{a:number}>')
    expect(shapeOfJson([])).toBe('array<empty>')
  })
})

describe('shapeOfBody', () => {
  test('null for empty/absent bodies', () => {
    expect(shapeOfBody(null)).toBeNull()
    expect(shapeOfBody(undefined)).toBeNull()
    expect(shapeOfBody('')).toBeNull()
  })

  test('null for non-JSON bodies', () => {
    expect(shapeOfBody('not json')).toBeNull()
  })

  test('computes shape for JSON bodies', () => {
    expect(shapeOfBody('{"a":1}')).toBe('{a:number}')
  })
})

describe('normalizeRequestsForBaseline', () => {
  test('groups requests by method + host + templated path', () => {
    const requests = [
      req({ url: 'https://api.example.com/users/1', method: 'GET', status: 200 }),
      req({ url: 'https://api.example.com/users/2', method: 'GET', status: 200 }),
    ]
    const result = normalizeRequestsForBaseline(requests)
    expect(result).toHaveLength(1)
    expect(result[0]!.key).toBe('GET api.example.com/users/:id')
  })

  test('unions statuses observed across calls to the same endpoint', () => {
    const requests = [
      req({ url: 'https://api.example.com/users/1', status: 200 }),
      req({ url: 'https://api.example.com/users/2', status: 404 }),
    ]
    const result = normalizeRequestsForBaseline(requests)
    expect(result[0]!.statuses).toEqual(['200', '404'])
  })

  test('a network error becomes the ERROR sentinel status', () => {
    const requests = [req({ url: 'https://api.example.com/x', status: undefined, error: 'ECONNRESET' })]
    const result = normalizeRequestsForBaseline(requests)
    expect(result[0]!.statuses).toEqual(['ERROR'])
  })

  test('strips volatile headers and keeps stable ones', () => {
    const requests = [
      req({
        url: 'https://api.example.com/x',
        requestHeaders: { Date: 'now', 'X-Request-Id': 'abc', 'Content-Type': 'application/json' },
      }),
    ]
    const result = normalizeRequestsForBaseline(requests)
    expect(result[0]!.requestHeaderNames).toEqual(['content-type'])
  })

  test('unions request body shapes across calls, ignoring values', () => {
    const requests = [
      req({ url: 'https://api.example.com/x', method: 'POST', requestBody: JSON.stringify({ name: 'a' }) }),
      req({
        url: 'https://api.example.com/x',
        method: 'POST',
        requestBody: JSON.stringify({ name: 'b', extra: true }),
      }),
    ]
    const result = normalizeRequestsForBaseline(requests)
    expect(result[0]!.requestBodyShapes).toEqual(['{extra:boolean,name:string}', '{name:string}'])
  })

  test('skips requests with an unparsable url rather than throwing', () => {
    const requests = [req({ url: 'not a url' })]
    expect(normalizeRequestsForBaseline(requests)).toEqual([])
  })

  test('output is sorted by key for stable diffs', () => {
    const requests = [req({ url: 'https://api.example.com/zebra' }), req({ url: 'https://api.example.com/alpha' })]
    const result = normalizeRequestsForBaseline(requests)
    expect(result.map((e) => e.key)).toEqual(['GET api.example.com/alpha', 'GET api.example.com/zebra'])
  })
})
