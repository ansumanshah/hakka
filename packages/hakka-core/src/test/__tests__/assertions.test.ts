import { describe, test, expect } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import {
  assertStatus,
  assertBody,
  assertBodyContains,
  assertResponseHeader,
  assertRequestHeader,
  assertRequestBody,
  assertIsError,
  assertIsSuccess,
  assertIsMocked,
  assertRequestMade,
  assertRequestNotMade,
  assertRequestCount,
} from '../assertions'
import { HakkaAssertionError } from '../HakkaAssertionError'

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

describe('assertStatus', () => {
  test('passes when status matches', () => {
    expect(() => assertStatus(makeRequest({ status: 200 }), 200)).not.toThrow()
  })

  test('error message includes expected and actual status', () => {
    let msg = ''
    try {
      assertStatus(makeRequest({ status: 500 }), 200)
    } catch (e: unknown) {
      if (e instanceof HakkaAssertionError) msg = e.message
    }
    expect(msg).toContain('200')
    expect(msg).toContain('500')
  })
})

describe('assertBody', () => {
  test('passes when body matches exactly', () => {
    expect(() => assertBody(makeRequest({ responseBody: '{"ok":true}' }), '{"ok":true}')).not.toThrow()
  })

  test('throws on mismatch', () => {
    expect(() => assertBody(makeRequest({ responseBody: 'hello' }), 'world')).toThrow(HakkaAssertionError)
  })
})

describe('assertBodyContains', () => {
  test('passes when body contains substring', () => {
    expect(() => assertBodyContains(makeRequest({ responseBody: '{"users":[1,2,3]}' }), '"users"')).not.toThrow()
  })

  test('throws when substring absent', () => {
    expect(() => assertBodyContains(makeRequest({ responseBody: '{}' }), '"users"')).toThrow(HakkaAssertionError)
  })
})

describe('assertResponseHeader', () => {
  const r = makeRequest({ responseHeaders: { 'content-type': 'application/json', 'x-cache': 'hit' } })

  test('passes when header exists with correct value', () => {
    expect(() => assertResponseHeader(r, 'x-cache', 'hit')).not.toThrow()
  })

  test('throws when header is missing', () => {
    expect(() => assertResponseHeader(r, 'authorization')).toThrow(HakkaAssertionError)
  })

  test('throws when header value mismatches', () => {
    expect(() => assertResponseHeader(r, 'x-cache', 'miss')).toThrow(HakkaAssertionError)
  })
})

describe('assertRequestHeader', () => {
  const r = makeRequest({ requestHeaders: { authorization: 'Bearer token123' } })

  test('passes with matching value', () => {
    expect(() => assertRequestHeader(r, 'authorization', 'Bearer token123')).not.toThrow()
  })

  test('throws when header is missing', () => {
    expect(() => assertRequestHeader(r, 'x-api-key')).toThrow(HakkaAssertionError)
  })
})

describe('assertRequestBody', () => {
  test('passes on exact match', () => {
    expect(() => assertRequestBody(makeRequest({ requestBody: '{"name":"Alice"}' }), '{"name":"Alice"}')).not.toThrow()
  })

  test('throws on mismatch', () => {
    expect(() => assertRequestBody(makeRequest({ requestBody: '{}' }), '{"name":"Alice"}')).toThrow(HakkaAssertionError)
  })
})

describe('assertIsError', () => {
  test('passes when request has error', () => {
    expect(() => assertIsError(makeRequest({ error: 'Network timeout' }))).not.toThrow()
  })

  test('throws when no error', () => {
    expect(() => assertIsError(makeRequest({ status: 200 }))).toThrow(HakkaAssertionError)
  })
})

describe('assertIsSuccess', () => {
  test('passes for 2xx status with no error', () => {
    expect(() => assertIsSuccess(makeRequest({ status: 200 }))).not.toThrow()
  })

  test('throws for 4xx status', () => {
    expect(() => assertIsSuccess(makeRequest({ status: 404 }))).toThrow(HakkaAssertionError)
  })
})

describe('assertIsMocked', () => {
  test('passes when mocked=true', () => {
    expect(() => assertIsMocked(makeRequest({ mocked: true }))).not.toThrow()
  })

  test('throws when not mocked', () => {
    expect(() => assertIsMocked(makeRequest({ mocked: undefined }))).toThrow(HakkaAssertionError)
  })
})

const sampleLogs: NetworkRequest[] = [
  makeRequest({ url: 'https://api.example.com/users', method: 'GET', status: 200 }),
  makeRequest({ url: 'https://api.example.com/posts', method: 'POST', status: 201 }),
  makeRequest({ url: 'https://api.example.com/auth/login', method: 'POST', status: 401 }),
  makeRequest({ url: 'https://api.example.com/users/1', method: 'GET', status: 200 }),
]

describe('assertRequestMade', () => {
  test('returns matched request when found', () => {
    const r = assertRequestMade(sampleLogs, { url: '/posts', method: 'POST' })
    expect(r.status).toBe(201)
  })

  test('throws with clear message when not found', () => {
    let msg = ''
    try {
      assertRequestMade(sampleLogs, { url: '/missing' })
    } catch (e: unknown) {
      if (e instanceof HakkaAssertionError) msg = e.message
    }
    expect(msg).toContain('/missing')
    expect(msg).toContain('Captured 4')
  })
})

describe('assertRequestNotMade', () => {
  test('passes when no matching request exists', () => {
    expect(() => assertRequestNotMade(sampleLogs, { url: '/comments' })).not.toThrow()
  })

  test('throws when matching request found', () => {
    expect(() => assertRequestNotMade(sampleLogs, { url: '/posts' })).toThrow(HakkaAssertionError)
  })
})

describe('assertRequestCount', () => {
  test('passes when count matches', () => {
    expect(() => assertRequestCount(sampleLogs, { method: 'GET' }, 2)).not.toThrow()
  })

  test('throws when count differs', () => {
    expect(() => assertRequestCount(sampleLogs, { method: 'GET' }, 1)).toThrow(HakkaAssertionError)
  })
})
