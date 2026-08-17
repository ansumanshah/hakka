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
