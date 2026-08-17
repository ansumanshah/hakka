import { RetentionPolicy, RingBuffer } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

function makeRequest(id: string, startTime = Date.now()): NetworkRequest {
  return {
    id,
    url: `https://example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime,
    duration: 100,
    requestHeaders: {},
    responseHeaders: {},
    requestBodySize: 0,
    responseBodySize: 0,
    requestBody: null,
    responseBody: null,
    error: null,
    source: 'fetch',
  }
}

describe('RetentionPolicy', () => {
  it('removes entries older than maxAge', () => {
    const buf = new RingBuffer(10)
    const old = Date.now() - 60000 // 60s ago
    buf.add(makeRequest('old', old))
    buf.add(makeRequest('new', Date.now()))

    const policy = new RetentionPolicy(30000) // 30s max age
    policy.apply(buf)

    expect(buf.get('old')).toBeUndefined()
    expect(buf.get('new')?.id).toBe('new')
  })

  it('does nothing when maxAge is null', () => {
    const buf = new RingBuffer(10)
    buf.add(makeRequest('old', Date.now() - 999999))
    buf.add(makeRequest('new'))

    const policy = new RetentionPolicy(null)
    policy.apply(buf)

    expect(buf.get('old')?.id).toBe('old')
    expect(buf.get('new')?.id).toBe('new')
  })

  it('max count is enforced by RingBuffer capacity', () => {
    const buf = new RingBuffer(2)
    buf.add(makeRequest('1'))
    buf.add(makeRequest('2'))
    buf.add(makeRequest('3'))

    expect(buf.size).toBe(2)
    expect(buf.get('1')).toBeUndefined()
  })
})
