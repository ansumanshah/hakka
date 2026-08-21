import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { buildReproBundle, REPRO_BUNDLE_SCHEMA_VERSION } from '../buildReproBundle'
import { createReproBundleExporter, deserializeReproBundle, serializeReproBundle } from '../serializeReproBundle'

let idSeq = 0
function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  idSeq++
  return {
    id: `req-${idSeq}`,
    url: 'https://api.example.com/users/1',
    method: 'GET',
    status: 200,
    startTime: idSeq,
    responseBody: '{"ok":true}',
    ...overrides,
  }
}

describe('buildReproBundle', () => {
  test('carries the requests through untouched', () => {
    const requests = [makeRequest(), makeRequest({ url: 'https://api.example.com/orders/9', method: 'POST' })]
    const bundle = buildReproBundle(requests)
    expect(bundle.requests).toEqual(requests)
  })

  test('stamps the current schema version', () => {
    const bundle = buildReproBundle([makeRequest()])
    expect(bundle.version).toBe(REPRO_BUNDLE_SCHEMA_VERSION)
  })

  test('stamps exportedAt as an ISO string by default', () => {
    const bundle = buildReproBundle([makeRequest()])
    expect(typeof bundle.exportedAt).toBe('string')
    expect(() => new Date(bundle.exportedAt!).toISOString()).not.toThrow()
  })

  test('honors an explicit exportedAt for deterministic output', () => {
    const bundle = buildReproBundle([makeRequest()], { exportedAt: '2026-01-01T00:00:00.000Z' })
    expect(bundle.exportedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  test('omits meta when not provided', () => {
    const bundle = buildReproBundle([makeRequest()])
    expect(bundle.meta).toBeUndefined()
  })

  test('attaches free-form meta when provided', () => {
    const meta = { failure: 'checkout 500s under load', device: 'iPhone 15' }
    const bundle = buildReproBundle([makeRequest()], { meta })
    expect(bundle.meta).toEqual(meta)
  })

  test('mocks are generated from requests via generateMockRules (dedup, newest-wins)', () => {
    const older = makeRequest({
      url: 'https://api.example.com/users/1',
      startTime: 1,
      responseBody: '{"name":"old"}',
    })
    const newer = makeRequest({
      url: 'https://api.example.com/users/1',
      startTime: 2,
      responseBody: '{"name":"new"}',
    })
    const bundle = buildReproBundle([older, newer])
    expect(bundle.mocks.length).toBe(1)
    expect(bundle.mocks[0]?.response.body).toBe('{"name":"new"}')
    expect(bundle.mocks[0]?.pattern).toBe('/users/1')
  })

  test('mints mock rule ids with the "repro" prefix by default', () => {
    const bundle = buildReproBundle([
      makeRequest({ url: 'https://api.example.com/a' }),
      makeRequest({ url: 'https://api.example.com/b' }),
    ])
    expect(bundle.mocks.map((m) => m.id).sort()).toEqual(['repro-1', 'repro-2'])
  })

  test('mockOptions.idPrefix overrides the default prefix', () => {
    const bundle = buildReproBundle([makeRequest({ url: 'https://api.example.com/a' })], {
      mockOptions: { idPrefix: 'custom' },
    })
    expect(bundle.mocks[0]?.id).toBe('custom-1')
  })

  test('skips requests with no usable response when generating mocks, but still keeps them in `requests`', () => {
    const pending = makeRequest({ status: undefined, responseBody: undefined })
    const bundle = buildReproBundle([pending])
    expect(bundle.requests).toEqual([pending])
    expect(bundle.mocks).toEqual([])
  })

  test('empty input produces an empty bundle', () => {
    const bundle = buildReproBundle([])
    expect(bundle.requests).toEqual([])
    expect(bundle.mocks).toEqual([])
  })
})

describe('serializeReproBundle / deserializeReproBundle — round trip', () => {
  test('round-trips requests + mocks with no metadata', () => {
    const requests = [makeRequest(), makeRequest({ url: 'https://api.example.com/orders/9', method: 'POST' })]
    const bundle = buildReproBundle(requests, { exportedAt: '2026-01-01T00:00:00.000Z' })
    const json = serializeReproBundle(bundle)
    const result = deserializeReproBundle(json)

    expect(result.requests).toEqual(bundle.requests)
    expect(result.mocks).toEqual(bundle.mocks)
    expect(result.version).toBe(REPRO_BUNDLE_SCHEMA_VERSION)
    expect(result.meta).toBeUndefined()
  })

  test('round-trips metadata', () => {
    const meta = { failure: 'checkout 500', note: 'repro for #123' }
    const bundle = buildReproBundle([makeRequest()], { meta })
    const json = serializeReproBundle(bundle)
    const result = deserializeReproBundle(json)
    expect(result.meta).toEqual(meta)
  })

  test('serialized output is valid JSON with the hakkaReproBundle marker and exportedAt', () => {
    const bundle = buildReproBundle([makeRequest()])
    const json = serializeReproBundle(bundle)
    const parsed = JSON.parse(json)
    expect(parsed.hakkaReproBundle).toBe(REPRO_BUNDLE_SCHEMA_VERSION)
    expect(typeof parsed.exportedAt).toBe('string')
    expect(Array.isArray(parsed.requests)).toBe(true)
    expect(Array.isArray(parsed.mocks)).toBe(true)
  })

  test('round-trips an empty bundle', () => {
    const bundle = buildReproBundle([])
    const json = serializeReproBundle(bundle)
    const result = deserializeReproBundle(json)
    expect(result.requests).toEqual([])
    expect(result.mocks).toEqual([])
  })
})

describe('deserializeReproBundle — tolerant parse', () => {
  test('ignores unknown top-level fields', () => {
    const json = JSON.stringify({
      hakkaReproBundle: 1,
      requests: [makeRequest()],
      mocks: [],
      somethingFromTheFuture: true,
    })
    const result = deserializeReproBundle(json)
    expect(result.requests.length).toBe(1)
    expect(result.mocks).toEqual([])
  })

  test('throws on invalid JSON', () => {
    expect(() => deserializeReproBundle('{not valid')).toThrow(/invalid JSON/)
  })

  test('throws when not a JSON object', () => {
    expect(() => deserializeReproBundle('[1,2,3]')).toThrow(/expected a JSON object/)
  })

  test('throws when missing the hakkaReproBundle marker', () => {
    expect(() => deserializeReproBundle(JSON.stringify({ requests: [], mocks: [] }))).toThrow(
      /hakkaReproBundle.*schema marker/,
    )
  })

  test('throws when requests is missing or not an array', () => {
    expect(() => deserializeReproBundle(JSON.stringify({ hakkaReproBundle: 1, mocks: [] }))).toThrow(
      /"requests" is missing or not an array/,
    )
  })

  test('throws when mocks is missing or not an array', () => {
    expect(() => deserializeReproBundle(JSON.stringify({ hakkaReproBundle: 1, requests: [] }))).toThrow(
      /"mocks" is missing or not an array/,
    )
  })

  test('ignores a non-object meta rather than throwing', () => {
    const json = JSON.stringify({ hakkaReproBundle: 1, requests: [], mocks: [], meta: 'not-an-object' })
    const result = deserializeReproBundle(json)
    expect(result.meta).toBeUndefined()
  })

  test('round-trips redaction when present', () => {
    const bundle = buildReproBundle([makeRequest({ requestBody: JSON.stringify({ password: 'sk-live-secret' }) })])
    const json = serializeReproBundle(bundle)
    const result = deserializeReproBundle(json)
    expect(result.redaction?.applied).toBe(true)
    expect(result.redaction?.removed.length).toBeGreaterThan(0)
  })

  test('leaves redaction undefined for a file that predates the field', () => {
    const json = JSON.stringify({ hakkaReproBundle: 1, requests: [], mocks: [] })
    const result = deserializeReproBundle(json)
    expect(result.redaction).toBeUndefined()
  })
})

describe('buildReproBundle — share-time scrubbing (default on)', () => {
  const SECRET = 'sk-live-abcdef0123456789'

  test('a secret in a header, JSON body field, query string, cookie, and nested body object does not appear anywhere in the bundle by default', () => {
    const request = makeRequest({
      url: `https://api.example.com/chat?api_key=${SECRET}`,
      requestHeaders: { Authorization: `Bearer ${SECRET}`, Cookie: `session=${SECRET}` },
      requestBody: JSON.stringify({ password: SECRET, nested: { token: SECRET } }),
      responseBody: JSON.stringify({ ok: true }),
    })
    const bundle = buildReproBundle([request])
    expect(JSON.stringify(bundle)).not.toContain(SECRET)
    expect(bundle.redaction.applied).toBe(true)
    expect(bundle.redaction.removed.length).toBeGreaterThan(0)
  })

  test('mocks generated from the request are scrubbed too — a mock built from an unscrubbed capture would replay the secret forever', () => {
    const request = makeRequest({
      url: 'https://api.example.com/users/1',
      responseBody: JSON.stringify({ token: SECRET }),
    })
    const bundle = buildReproBundle([request])
    expect(JSON.stringify(bundle.mocks)).not.toContain(SECRET)
  })

  test('scrub: false opts out explicitly', () => {
    const request = makeRequest({ requestBody: JSON.stringify({ password: SECRET }) })
    const bundle = buildReproBundle([request], { scrub: false })
    expect(JSON.stringify(bundle)).toContain(SECRET)
    expect(bundle.redaction).toEqual({ applied: false, removed: [] })
  })

  test('createReproBundleExporter stays byte-for-byte lossless — it force-disables scrub regardless of the secret present', () => {
    const request = makeRequest({ requestBody: JSON.stringify({ password: SECRET }) })
    const exporter = createReproBundleExporter()
    const output = exporter.export([request]) as string
    expect(exporter.lossy).toBe(false)
    expect(output).toContain(SECRET)
  })
})
