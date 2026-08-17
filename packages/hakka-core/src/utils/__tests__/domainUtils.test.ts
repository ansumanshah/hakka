import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { calculateDomainStats, extractHost, getUniqueDomains } from '../domainUtils'

describe('extractHost', () => {
  test('extracts hostname from a simple HTTPS URL', () => {
    expect(extractHost('https://example.com/path')).toBe('example.com')
  })

  test('handles IPv6 addresses', () => {
    expect(extractHost('https://[::1]:8080/path')).toBe('[::1]')
  })

  test('strips userinfo credentials', () => {
    expect(extractHost('https://user:pass@example.com/path')).toBe('example.com')
  })

  test('returns unknown for invalid URLs', () => {
    expect(extractHost('not-a-url')).toBe('unknown')
    expect(extractHost('')).toBe('unknown')
  })
})

const makeRequest = (overrides: Partial<NetworkRequest> & { url: string; method: string }): NetworkRequest => ({
  id: 'test-id',
  startTime: Date.now(),
  method: overrides.method,
  url: overrides.url,
  status: overrides.status ?? 200,
  duration: overrides.duration ?? 0,
  size: overrides.size ?? 0,
  requestHeaders: overrides.requestHeaders ?? {},
  responseHeaders: overrides.responseHeaders ?? {},
  requestBody: overrides.requestBody ?? null,
  responseBody: overrides.responseBody ?? null,
  ...overrides,
})

describe('getUniqueDomains', () => {
  test('returns sorted unique domains', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://beta.example.com/a', method: 'GET' }),
      makeRequest({ url: 'https://alpha.example.com/b', method: 'GET' }),
      makeRequest({ url: 'https://beta.example.com/c', method: 'GET' }),
    ]
    expect(getUniqueDomains(logs)).toEqual(['alpha.example.com', 'beta.example.com'])
  })

  test('returns empty array for no logs', () => {
    expect(getUniqueDomains([])).toEqual([])
  })

  test('drops unparseable URLs instead of bucketing them under "unknown"', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'not-a-url', method: 'GET' }),
      makeRequest({ url: 'also-not-a-url', method: 'GET' }),
    ]
    expect(getUniqueDomains(logs)).toEqual([])
  })

  test('drops non-http(s) captures — e.g. a Metro/dev-server URL whose scheme is not http(s), where the host component is really a versioned build identifier', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://api.example.com/users', method: 'GET' }),
      // Non-http(s) scheme whose "hostname" is actually a build version+hash, not a real API host.
      makeRequest({ url: 'exp://0.85.3+13717e69d21c358c', method: 'GET' }),
      makeRequest({ url: 'metro://0.85.3+13717e69d21c358c/symbolicate', method: 'GET' }),
    ]
    expect(getUniqueDomains(logs)).toEqual(['api.example.com'])
  })

  test('keeps real http(s) hosts even when a garbage non-http entry sorts alongside them', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://beta.example.com/a', method: 'GET' }),
      makeRequest({ url: 'hakka-internal://0.1.0+deadbeef', method: 'GET' }),
      makeRequest({ url: 'https://alpha.example.com/b', method: 'GET' }),
    ]
    expect(getUniqueDomains(logs)).toEqual(['alpha.example.com', 'beta.example.com'])
  })
})

describe('calculateDomainStats', () => {
  test('filters only matching domain requests', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://api.example.com/users', method: 'GET', status: 200, duration: 100 }),
      makeRequest({ url: 'https://other.com/users', method: 'GET', status: 200, duration: 50 }),
    ]
    const stats = calculateDomainStats(logs, 'api.example.com')
    expect(stats.totalRequests).toBe(1)
    expect(stats.domain).toBe('api.example.com')
  })

  test('calculates success, failure, and informational rates', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://api.example.com/a', method: 'GET', status: 200 }),
      makeRequest({ url: 'https://api.example.com/b', method: 'GET', status: 404 }),
      makeRequest({ url: 'https://api.example.com/c', method: 'GET', status: 100 }),
      makeRequest({ url: 'https://api.example.com/d', method: 'GET', status: 500 }),
    ]
    const stats = calculateDomainStats(logs, 'api.example.com')
    expect(stats.totalRequests).toBe(4)
    expect(stats.successRate).toBeCloseTo(0.25)
    expect(stats.failureRate).toBeCloseTo(0.5)
    expect(stats.informationalRate).toBeCloseTo(0.25)
  })

  test('calculates average, fastest, and slowest response times', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://api.example.com/a', method: 'GET', duration: 100 }),
      makeRequest({ url: 'https://api.example.com/b', method: 'GET', duration: 300 }),
    ]
    const stats = calculateDomainStats(logs, 'api.example.com')
    expect(stats.averageResponseTime).toBe(200)
    expect(stats.fastestRequest).toBe(100)
    expect(stats.slowestRequest).toBe(300)
  })

  test('calculates method breakdown and status code distribution', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://api.example.com/a', method: 'GET', status: 200 }),
      makeRequest({ url: 'https://api.example.com/b', method: 'POST', status: 201 }),
      makeRequest({ url: 'https://api.example.com/c', method: 'GET', status: 200 }),
    ]
    const stats = calculateDomainStats(logs, 'api.example.com')
    expect(stats.methodBreakdown).toEqual({ GET: 2, POST: 1 })
    expect(stats.statusCodeDistribution).toEqual({ 200: 2, 201: 1 })
  })

  test('accumulates dataSent and dataReceived', () => {
    const logs: NetworkRequest[] = [
      makeRequest({ url: 'https://api.example.com/a', method: 'POST', requestBody: '{"foo":"bar"}', size: 512 }),
      makeRequest({ url: 'https://api.example.com/b', method: 'GET', size: 1024 }),
    ]
    const stats = calculateDomainStats(logs, 'api.example.com')
    expect(stats.dataSent).toBe('{"foo":"bar"}'.length)
    expect(stats.dataReceived).toBe(1536)
  })

  test('returns zero stats for no matching requests', () => {
    const stats = calculateDomainStats([], 'api.example.com')
    expect(stats.totalRequests).toBe(0)
    expect(stats.successRate).toBe(0)
    expect(stats.averageResponseTime).toBe(0)
    expect(stats.fastestRequest).toBe(0)
  })
})
