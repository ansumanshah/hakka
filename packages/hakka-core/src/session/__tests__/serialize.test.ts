import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { deserializeSession, serializeSession, SESSION_SCHEMA_VERSION } from '../serialize'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    status: 200,
    startTime: 0,
    ...overrides,
  }
}

describe('serializeSession / deserializeSession — round trip', () => {
  test('round-trips requests with no metadata', () => {
    const requests = [makeRequest(), makeRequest({ id: 'req-2', method: 'POST' })]
    const json = serializeSession(requests)
    const result = deserializeSession(json)

    expect(result.requests).toEqual(requests)
    expect(result.version).toBe(SESSION_SCHEMA_VERSION)
    expect(result.meta).toBeUndefined()
  })

  test('round-trips requests with metadata', () => {
    const requests = [makeRequest()]
    const meta = { device: 'iPhone 15', appVersion: '2.3.0', note: 'repro for #123' }
    const json = serializeSession(requests, meta)
    const result = deserializeSession(json)

    expect(result.requests).toEqual(requests)
    expect(result.meta).toEqual(meta)
  })

  test('serialized output is valid JSON with the hakkaSession marker and exportedAt', () => {
    const json = serializeSession([makeRequest()])
    const parsed = JSON.parse(json)
    expect(parsed.hakkaSession).toBe(SESSION_SCHEMA_VERSION)
    expect(typeof parsed.exportedAt).toBe('string')
    expect(Array.isArray(parsed.requests)).toBe(true)
  })

  test('round-trips an empty request list', () => {
    const json = serializeSession([])
    const result = deserializeSession(json)
    expect(result.requests).toEqual([])
  })
})

describe('deserializeSession — tolerant parse', () => {
  test('ignores unknown top-level fields', () => {
    const json = JSON.stringify({
      hakkaSession: 1,
      requests: [makeRequest()],
      somethingFromTheFuture: true,
    })
    const result = deserializeSession(json)
    expect(result.requests).toHaveLength(1)
  })

  test('meta is omitted (not present) when absent from the payload', () => {
    const json = JSON.stringify({ hakkaSession: 1, requests: [] })
    const result = deserializeSession(json)
    expect(result.meta).toBeUndefined()
  })
})

describe('deserializeSession — error handling', () => {
  test('throws a clear Error on invalid JSON', () => {
    expect(() => deserializeSession('not json{{{')).toThrow(/invalid JSON/i)
  })

  test('throws a clear Error on a non-Hakka payload (missing marker)', () => {
    expect(() => deserializeSession(JSON.stringify({ foo: 'bar' }))).toThrow(/not a Hakka session payload/i)
  })

  test('throws a clear Error when requests is not an array', () => {
    expect(() => deserializeSession(JSON.stringify({ hakkaSession: 1, requests: 'nope' }))).toThrow(
      /not a Hakka session payload/i,
    )
  })

  test('throws a clear Error on a HAR file (a plausible non-Hakka payload)', () => {
    const har = JSON.stringify({ log: { version: '1.2', entries: [] } })
    expect(() => deserializeSession(har)).toThrow(/not a Hakka session payload/i)
  })

  test('throws a clear Error on a JSON array at the top level', () => {
    expect(() => deserializeSession(JSON.stringify([1, 2, 3]))).toThrow(/not a Hakka session payload/i)
  })
})
