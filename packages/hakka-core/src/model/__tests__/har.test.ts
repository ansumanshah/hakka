import { describe, expect, test } from 'bun:test'

import { requestToHarEntry } from '../har'
import type { NetworkRequest } from '../types'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'r1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    startTime: Date.now(),
    ...overrides,
  }
}

describe('HAR timings — send field', () => {
  test('timing.send is forwarded to entry.timings.send', () => {
    const entry = requestToHarEntry(makeRequest({ timing: { send: 15 } }))
    expect(entry.timings.send).toBe(15)
  })

  test('defaults send to 0 when timing is undefined', () => {
    const entry = requestToHarEntry(makeRequest())
    expect(entry.timings.send).toBe(0)
  })

  test('defaults send to 0 when timing.send is undefined', () => {
    const entry = requestToHarEntry(makeRequest({ timing: { ttfbMs: 100 } }))
    expect(entry.timings.send).toBe(0)
  })
})

describe('HAR timings — sum clamping', () => {
  test('send+wait+receive does not exceed total time when only downloadMs present', () => {
    const entry = requestToHarEntry(
      makeRequest({
        duration: 200,
        timing: { downloadMs: 50 },
      }),
    )
    const { send, wait, receive } = entry.timings
    expect(send + wait + receive).toBe(200)
    expect(receive).toBe(50)
    expect(wait).toBe(150)
    expect(send).toBe(0)
  })

  test('when ttfb and download both present, wait=ttfb, receive=download, sum<=time', () => {
    const entry = requestToHarEntry(
      makeRequest({
        duration: 300,
        timing: { ttfbMs: 200, downloadMs: 80 },
      }),
    )
    const { send, wait, receive } = entry.timings
    expect(wait).toBe(200)
    expect(receive).toBe(80)
    // sum should be clamped to <= time
    expect(send + wait + receive).toBeLessThanOrEqual(300)
  })

  test('when no timing fields provided, wait equals total time, receive=0', () => {
    const entry = requestToHarEntry(makeRequest({ duration: 100 }))
    const { send, wait, receive } = entry.timings
    expect(send).toBe(0)
    expect(receive).toBe(0)
    expect(wait).toBe(100)
    expect(send + wait + receive).toBe(100)
  })

  test('non-negative clamping: receive never goes negative', () => {
    // ttfb > time — pathological input
    const entry = requestToHarEntry(
      makeRequest({
        duration: 50,
        timing: { ttfbMs: 200, downloadMs: 100 },
      }),
    )
    const { send, wait, receive } = entry.timings
    expect(send).toBeGreaterThanOrEqual(0)
    expect(wait).toBeGreaterThanOrEqual(0)
    expect(receive).toBeGreaterThanOrEqual(0)
  })
})

describe('HAR headersSize', () => {
  test('request.headersSize is -1 (unknown per spec)', () => {
    const entry = requestToHarEntry(makeRequest({ requestHeaders: { 'Content-Type': 'application/json' } }))
    expect(entry.request.headersSize).toBe(-1)
  })

  test('response.headersSize is -1 (unknown per spec)', () => {
    const entry = requestToHarEntry(makeRequest({ responseHeaders: { 'Content-Type': 'application/json' } }))
    expect(entry.response.headersSize).toBe(-1)
  })

  test('headersSize is -1 even with no headers', () => {
    const entry = requestToHarEntry(makeRequest())
    expect(entry.request.headersSize).toBe(-1)
    expect(entry.response.headersSize).toBe(-1)
  })
})

describe('HAR bodySize — UTF-8 byte count', () => {
  test('ASCII body: byte count equals char count', () => {
    const entry = requestToHarEntry(makeRequest({ method: 'POST', requestBody: 'hello' }))
    expect(entry.request.bodySize).toBe(5)
  })

  test('multi-byte UTF-8 body: byte count is correct (not char count)', () => {
    // '你好' = 2 chars, 6 UTF-8 bytes
    const entry = requestToHarEntry(makeRequest({ method: 'POST', requestBody: '你好' }))
    expect(entry.request.bodySize).toBe(6)
  })

  test('emoji body: 4 bytes per emoji', () => {
    // '😀' = 1 char (JS), 4 UTF-8 bytes
    const entry = requestToHarEntry(makeRequest({ method: 'POST', requestBody: '😀' }))
    expect(entry.request.bodySize).toBe(4)
  })

  test('response bodySize uses UTF-8 byte length', () => {
    const entry = requestToHarEntry(makeRequest({ responseBody: '你好' }))
    expect(entry.response.bodySize).toBe(6)
  })

  test('missing body gives bodySize=-1', () => {
    const entry = requestToHarEntry(makeRequest())
    expect(entry.request.bodySize).toBe(-1)
    expect(entry.response.bodySize).toBe(-1)
  })
})

describe('HAR postData mimeType — case-insensitive lookup', () => {
  test('lowercase content-type header (fetch path)', () => {
    const entry = requestToHarEntry(
      makeRequest({
        method: 'POST',
        requestBody: '{}',
        requestHeaders: { 'content-type': 'application/json' },
      }),
    )
    expect(entry.request.postData?.mimeType).toBe('application/json')
  })

  test('title-case Content-Type header (XHR path)', () => {
    const entry = requestToHarEntry(
      makeRequest({
        method: 'POST',
        requestBody: '{}',
        requestHeaders: { 'Content-Type': 'application/json' },
      }),
    )
    expect(entry.request.postData?.mimeType).toBe('application/json')
  })

  test('mixed-case CONTENT-TYPE header', () => {
    const entry = requestToHarEntry(
      makeRequest({
        method: 'POST',
        requestBody: 'data',
        requestHeaders: { 'CONTENT-TYPE': 'text/plain' },
      }),
    )
    expect(entry.request.postData?.mimeType).toBe('text/plain')
  })

  test('falls back to application/octet-stream when header absent', () => {
    const entry = requestToHarEntry(makeRequest({ method: 'POST', requestBody: 'raw' }))
    expect(entry.request.postData?.mimeType).toBe('application/octet-stream')
  })

  test('no postData when requestBody is empty', () => {
    const entry = requestToHarEntry(makeRequest({ requestHeaders: { 'Content-Type': 'text/plain' } }))
    expect(entry.request.postData).toBeUndefined()
  })
})

// `responseHeaderValues` (ADR 0011) is an additive, backward-compatible
// widening of `responseHeaders` for header names that arrived with more than
// one real value (chiefly Set-Cookie). HAR 1.2's `headers` array natively
// supports repeated names, so a name covered by `responseHeaderValues` should
// emit one HAR header entry per real value instead of the folded one.
describe('HAR response headers — multi-value fidelity via responseHeaderValues', () => {
  test('two Set-Cookie values produce two HAR header entries, not one folded entry', () => {
    const entry = requestToHarEntry(
      makeRequest({
        responseHeaders: { 'Set-Cookie': 'a=1; Path=/, b=2; Path=/' },
        responseHeaderValues: { 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] },
      }),
    )
    const cookieHeaders = entry.response.headers.filter((h) => h.name === 'Set-Cookie')
    expect(cookieHeaders).toHaveLength(2)
    expect(cookieHeaders.map((h) => h.value)).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  test('a header name not covered by responseHeaderValues still emits its folded value', () => {
    const entry = requestToHarEntry(
      makeRequest({
        responseHeaders: { 'Set-Cookie': 'a=1, b=2', 'Content-Type': 'application/json' },
        responseHeaderValues: { 'Set-Cookie': ['a=1', 'b=2'] },
      }),
    )
    const contentType = entry.response.headers.filter((h) => h.name === 'Content-Type')
    expect(contentType).toEqual([{ name: 'Content-Type', value: 'application/json' }])
  })

  test('backward compat: no responseHeaderValues still exports the folded value unchanged', () => {
    const entry = requestToHarEntry(
      makeRequest({
        responseHeaders: { 'Set-Cookie': 'a=1; Path=/, b=2; Path=/' },
      }),
    )
    expect(entry.response.headers).toEqual([{ name: 'Set-Cookie', value: 'a=1; Path=/, b=2; Path=/' }])
  })

  test('an empty responseHeaderValues array for a name falls back to the folded value', () => {
    const entry = requestToHarEntry(
      makeRequest({
        responseHeaders: { 'Set-Cookie': 'a=1' },
        responseHeaderValues: { 'Set-Cookie': [] },
      }),
    )
    expect(entry.response.headers).toEqual([{ name: 'Set-Cookie', value: 'a=1' }])
  })

  test('requestHeaders are unaffected — NetworkRequest has no requestHeaderValues field', () => {
    const entry = requestToHarEntry(makeRequest({ requestHeaders: { Accept: '*/*' } }))
    expect(entry.request.headers).toEqual([{ name: 'Accept', value: '*/*' }])
  })
})

describe('HAR queryString — malformed percent-escapes', () => {
  test('a single malformed pair is dropped raw, not discarding the whole query string', () => {
    const entry = requestToHarEntry(makeRequest({ url: 'http://x?a=1&q=100%&b=2' }))
    expect(entry.request.queryString).toEqual([
      { name: 'a', value: '1' },
      { name: 'q', value: '100%' },
      { name: 'b', value: '2' },
    ])
  })

  test('a malformed name (not just value) also falls back to its raw form', () => {
    const entry = requestToHarEntry(makeRequest({ url: 'http://x?100%=bad&ok=1' }))
    expect(entry.request.queryString).toEqual([
      { name: '100%', value: 'bad' },
      { name: 'ok', value: '1' },
    ])
  })

  test('all-valid query strings still decode normally', () => {
    const entry = requestToHarEntry(makeRequest({ url: 'http://x?a=hello%20world' }))
    expect(entry.request.queryString).toEqual([{ name: 'a', value: 'hello world' }])
  })
})
