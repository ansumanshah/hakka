import { buildHar, requestToHarEntry, exportHarString } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

const makeRequest = (overrides: Partial<NetworkRequest> = {}): NetworkRequest => ({
  id: 'req_1',
  url: 'https://api.example.com/users',
  method: 'GET',
  status: 200,
  startTime: 1700000000000,
  endTime: 1700000000250,
  timestamp: 1700000000000,
  duration: 250,
  requestHeaders: { accept: 'application/json', authorization: 'Bearer token' },
  responseHeaders: { 'content-type': 'application/json; charset=utf-8', 'x-request-id': 'abc123' },
  responseBody: '{"users":[]}',
  contentType: 'application/json',
  size: 12,
  ...overrides,
})

describe('requestToHarEntry', () => {
  it('sets correct startedDateTime from timestamp', () => {
    const req = makeRequest({ timestamp: 1700000000000 })
    const entry = requestToHarEntry(req)
    expect(entry.startedDateTime).toBe(new Date(1700000000000).toISOString())
  })

  it('sets correct total time', () => {
    const entry = requestToHarEntry(makeRequest({ duration: 250 }))
    expect(entry.time).toBe(250)
  })

  it('sets request method and URL', () => {
    const entry = requestToHarEntry(makeRequest())
    expect(entry.request.method).toBe('GET')
    expect(entry.request.url).toBe('https://api.example.com/users')
  })

  it('converts request headers to HAR format', () => {
    const entry = requestToHarEntry(makeRequest())
    expect(entry.request.headers).toContainEqual({ name: 'accept', value: 'application/json' })
  })

  it('parses query string parameters', () => {
    const req = makeRequest({ url: 'https://api.example.com/search?q=hello&page=1' })
    const entry = requestToHarEntry(req)
    expect(entry.request.queryString).toContainEqual({ name: 'q', value: 'hello' })
    expect(entry.request.queryString).toContainEqual({ name: 'page', value: '1' })
  })

  it('sets response status and statusText', () => {
    const entry = requestToHarEntry(makeRequest({ status: 200 }))
    expect(entry.response.status).toBe(200)
    expect(entry.response.statusText).toBe('OK')
  })

  it('includes response body in content', () => {
    const entry = requestToHarEntry(makeRequest({ responseBody: '{"data":true}' }))
    expect(entry.response.content.text).toBe('{"data":true}')
  })

  it('includes request body as postData for POST', () => {
    const req = makeRequest({
      method: 'POST',
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: '{"name":"test"}',
    })
    const entry = requestToHarEntry(req)
    expect(entry.request.postData).toBeDefined()
    expect(entry.request.postData!.text).toBe('{"name":"test"}')
  })

  it('populates timing from NetworkTiming', () => {
    const req = makeRequest({
      timing: { dnsMs: 10, connectMs: 20, tlsMs: 30, ttfbMs: 100, downloadMs: 90 },
    })
    const entry = requestToHarEntry(req)
    expect(entry.timings.dns).toBe(10)
    expect(entry.timings.connect).toBe(20)
    expect(entry.timings.ssl).toBe(30)
    expect(entry.timings.wait).toBe(100)
    expect(entry.timings.receive).toBe(90)
  })

  it('has empty cookies array', () => {
    const entry = requestToHarEntry(makeRequest())
    expect(entry.request.cookies).toEqual([])
    expect(entry.response.cookies).toEqual([])
  })

  it('has empty cache object', () => {
    const entry = requestToHarEntry(makeRequest())
    expect(entry.cache).toEqual({})
  })
})

describe('buildHar', () => {
  it('produces correct HAR version', () => {
    const har = buildHar([makeRequest()])
    expect(har.log.version).toBe('1.2')
  })

  it('includes creator info', () => {
    const har = buildHar([makeRequest()])
    // Platform-neutral creator — the shared hakka-core exporter serves every
    // platform, so it no longer claims hakka-react-native specifically.
    expect(har.log.creator.name).toBe('hakka-core')
  })

  it('builds entries for each request', () => {
    const requests = [makeRequest({ id: '1' }), makeRequest({ id: '2', url: 'https://api.example.com/posts' })]
    const har = buildHar(requests)
    expect(har.log.entries).toHaveLength(2)
  })

  it('returns empty entries for empty input', () => {
    const har = buildHar([])
    expect(har.log.entries).toEqual([])
  })
})

describe('exportHarString', () => {
  it('returns valid JSON string', () => {
    const str = exportHarString([makeRequest()])
    expect(() => JSON.parse(str)).not.toThrow()
  })

  it('contains log key at top level', () => {
    const parsed = JSON.parse(exportHarString([makeRequest()]))
    expect(parsed).toHaveProperty('log')
    expect(parsed.log).toHaveProperty('entries')
    expect(parsed.log).toHaveProperty('version', '1.2')
  })

  it('pretty-prints the JSON (indented)', () => {
    const str = exportHarString([makeRequest()])
    expect(str).toContain('\n')
  })
})

describe('HAR status text mapping', () => {
  const cases: Array<[number, string]> = [
    [200, 'OK'],
    [201, 'Created'],
    [204, 'No Content'],
    [301, 'Moved Permanently'],
    [400, 'Bad Request'],
    [401, 'Unauthorized'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
    [500, 'Internal Server Error'],
    [502, 'Bad Gateway'],
  ]

  cases.forEach(([status, text]) => {
    it(`maps status ${status} to "${text}"`, () => {
      const entry = requestToHarEntry(makeRequest({ status }))
      expect(entry.response.statusText).toBe(text)
    })
  })
})
