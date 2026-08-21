import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { detectLeaks } from '../leakDetection'

let seq = 0
function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  seq += 1
  return {
    id: over.id ?? `r${seq}`,
    url: over.url ?? 'https://api.example.com/users',
    method: over.method ?? 'GET',
    status: over.status ?? 200,
    startTime: over.startTime ?? seq,
    ...over,
  }
}

describe('detectLeaks — credential to a non-first-party host', () => {
  test('true positive: Bearer token sent to a host outside the allowlist', () => {
    const r = req({
      method: 'POST',
      url: 'https://analytics.thirdparty.com/collect',
      requestHeaders: { authorization: 'Bearer abcdefghijklmnop' },
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    const finding = result.findings.find((f) => f.kind === 'credential-to-third-party')
    expect(finding).toBeDefined()
    expect(finding!.confidence).toBe('high')
    expect(finding!.requestId).toBe(r.id)
    expect(finding!.evidence[0]!.location).toContain('authorization')
    // The raw token never appears in the finding.
    expect(JSON.stringify(finding)).not.toContain('abcdefghijklmnop')
  })

  test('near-miss: same credential sent to a first-party host stays silent', () => {
    const r = req({
      method: 'POST',
      url: 'https://api.example.com/track',
      requestHeaders: { authorization: 'Bearer abcdefghijklmnop' },
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'credential-to-third-party')).toBeUndefined()
  })

  test('near-miss: no allowlist and too few requests to infer one — detector does not run', () => {
    const r = req({
      url: 'https://analytics.thirdparty.com/collect',
      requestHeaders: { authorization: 'Bearer abcdefghijklmnop' },
    })
    const result = detectLeaks([r])
    expect(result.findings.find((f) => f.kind === 'credential-to-third-party')).toBeUndefined()
    expect(result.firstPartyHostsUsed).toEqual([])
  })

  test('auto-inference: a clear majority host becomes first-party by default', () => {
    const requests = [
      req({ url: 'https://api.example.com/a' }),
      req({ url: 'https://api.example.com/b' }),
      req({ url: 'https://api.example.com/c' }),
      req({
        url: 'https://analytics.thirdparty.com/collect',
        requestHeaders: { authorization: 'Bearer abcdefghijklmnop' },
      }),
    ]
    const result = detectLeaks(requests)
    expect(result.firstPartyHostsUsed).toEqual(['api.example.com'])
    expect(result.findings.find((f) => f.kind === 'credential-to-third-party')).toBeDefined()
  })

  test('near-miss: a flat/tied host distribution infers nothing', () => {
    const requests = [
      req({ url: 'https://a.example.com/x' }),
      req({ url: 'https://b.example.com/x' }),
      req({ url: 'https://c.example.com/x', requestHeaders: { authorization: 'Bearer abcdefghijklmnop' } }),
    ]
    const result = detectLeaks(requests)
    expect(result.firstPartyHostsUsed).toEqual([])
    expect(result.findings.find((f) => f.kind === 'credential-to-third-party')).toBeUndefined()
  })

  test('true positive: session cookie sent to a third-party host', () => {
    const r = req({
      url: 'https://tracker.example.net/beacon',
      requestHeaders: { cookie: 'theme=dark; connect.sid=s%3Aabcdefghij.somesignature' },
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    const finding = result.findings.find((f) => f.kind === 'credential-to-third-party')
    expect(finding).toBeDefined()
    expect(finding!.evidence[0]!.location).toContain('connect.sid')
  })

  test('near-miss: a non-session cookie (theme preference) to a third-party host is not a credential', () => {
    const r = req({
      url: 'https://tracker.example.net/beacon',
      requestHeaders: { cookie: 'theme=dark; ab_bucket=variant-b' },
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'credential-to-third-party')).toBeUndefined()
  })
})

describe('detectLeaks — a PII-shaped field appearing for the first time', () => {
  test('true positive: the 4th request to an endpoint starts carrying "email", unlike the prior 3', () => {
    const requests = [
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'view' }) }),
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'click' }) }),
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'scroll' }) }),
      req({
        method: 'POST',
        url: 'https://api.example.com/track',
        requestBody: JSON.stringify({ event: 'purchase', email: 'user@example.com' }),
      }),
    ]
    const result = detectLeaks(requests, { firstPartyHosts: ['api.example.com'] })
    const finding = result.findings.find((f) => f.kind === 'new-pii-field')
    expect(finding).toBeDefined()
    expect(finding!.confidence).toBe('medium')
    expect(finding!.evidence[0]!.location).toContain('email')
  })

  test('near-miss: the very first request to a brand-new endpoint carrying "email" has no baseline to compare against', () => {
    const r = req({
      method: 'POST',
      url: 'https://api.example.com/signup',
      requestBody: JSON.stringify({ email: 'user@example.com' }),
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'new-pii-field')).toBeUndefined()
  })

  test('near-miss: a new but non-PII-named field (couponCode) never triggers, even with an established baseline', () => {
    const requests = [
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'view' }) }),
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'click' }) }),
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'scroll' }) }),
      req({
        method: 'POST',
        url: 'https://api.example.com/track',
        requestBody: JSON.stringify({ event: 'purchase', couponCode: 'SAVE10' }),
      }),
    ]
    const result = detectLeaks(requests, { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'new-pii-field')).toBeUndefined()
  })

  test('a baseline threaded from a prior call carries forward', () => {
    const first = detectLeaks(
      [
        req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'view' }) }),
        req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'click' }) }),
        req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'scroll' }) }),
      ],
      { firstPartyHosts: ['api.example.com'] },
    )
    const second = detectLeaks(
      [
        req({
          method: 'POST',
          url: 'https://api.example.com/track',
          requestBody: JSON.stringify({ event: 'purchase', phone: '+15551234567' }),
        }),
      ],
      { firstPartyHosts: ['api.example.com'], fieldBaseline: first.fieldBaseline },
    )
    expect(second.findings.find((f) => f.kind === 'new-pii-field')).toBeDefined()
  })
})

describe('detectLeaks — PII in a URL or query string', () => {
  test('true positive: an email address in a query param', () => {
    const r = req({ url: 'https://api.example.com/lookup?email=someone%40example.com' })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    const finding = result.findings.find((f) => f.kind === 'pii-in-url')
    expect(finding).toBeDefined()
    expect(finding!.confidence).toBe('high')
  })

  test('near-miss: a plain numeric id in a query param is never treated as a phone number', () => {
    const r = req({ url: 'https://api.example.com/orders?order_id=48213913' })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'pii-in-url')).toBeUndefined()
  })

  test('near-miss: a phone-named param without a strict E.164 shape stays silent', () => {
    const r = req({ url: 'https://api.example.com/users?phone=9876543210' })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'pii-in-url')).toBeUndefined()
  })

  test('true positive: a strict E.164 phone number in a phone-named param', () => {
    const r = req({ url: 'https://api.example.com/users?phone=%2B15551234567' })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'pii-in-url')).toBeDefined()
  })
})

describe('detectLeaks — a credential somewhere that gets cached', () => {
  test('true positive: a JWT in a GET query string', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const r = req({ method: 'GET', url: `https://api.example.com/data?token=${jwt}` })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    const finding = result.findings.find((f) => f.kind === 'credential-in-cacheable-place')
    expect(finding).toBeDefined()
    expect(finding!.evidence[0]!.location).toContain('GET query param')
  })

  test('near-miss: the same credential-named param on a POST is not a caching concern (no logged URL)', () => {
    const r = req({ method: 'POST', url: 'https://api.example.com/data?token=abcdefghij12345' })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'credential-in-cacheable-place')).toBeUndefined()
  })

  test('true positive: a cacheable response body carries an API key field', () => {
    const r = req({
      method: 'GET',
      url: 'https://api.example.com/config',
      responseHeaders: { 'cache-control': 'public, max-age=3600' },
      responseBody: JSON.stringify({ apiKey: 'abcdefghijklmnopqrst', name: 'widget' }),
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    const finding = result.findings.find((f) => f.kind === 'credential-in-cacheable-place')
    expect(finding).toBeDefined()
    expect(finding!.evidence.some((e) => e.location.includes('apiKey'))).toBe(true)
  })

  test('near-miss: the same response body with Cache-Control: no-store stays silent', () => {
    const r = req({
      method: 'GET',
      url: 'https://api.example.com/config',
      responseHeaders: { 'cache-control': 'no-store' },
      responseBody: JSON.stringify({ apiKey: 'abcdefghijklmnopqrst', name: 'widget' }),
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'credential-in-cacheable-place')).toBeUndefined()
  })

  test('near-miss: a response with no caching headers at all is not assumed cacheable', () => {
    const r = req({
      method: 'GET',
      url: 'https://api.example.com/config',
      responseBody: JSON.stringify({ apiKey: 'abcdefghijklmnopqrst', name: 'widget' }),
    })
    const result = detectLeaks([r], { firstPartyHosts: ['api.example.com'] })
    expect(result.findings.find((f) => f.kind === 'credential-in-cacheable-place')).toBeUndefined()
  })
})

describe('detectLeaks — result shape', () => {
  test('empty input yields an honest empty summary', () => {
    const result = detectLeaks([])
    expect(result.findings).toEqual([])
    expect(result.summary).toContain('No leaks detected')
  })

  test('findings are ranked high confidence before medium', () => {
    const requests = [
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'view' }) }),
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'click' }) }),
      req({ method: 'POST', url: 'https://api.example.com/track', requestBody: JSON.stringify({ event: 'scroll' }) }),
      req({
        method: 'POST',
        url: 'https://api.example.com/track',
        requestBody: JSON.stringify({ event: 'purchase', email: 'user@example.com' }),
      }),
      req({ url: 'https://api.example.com/lookup?email=someone%40example.com' }),
    ]
    const result = detectLeaks(requests, { firstPartyHosts: ['api.example.com'] })
    const kinds = result.findings.map((f) => f.kind)
    expect(kinds.indexOf('pii-in-url')).toBeLessThan(kinds.indexOf('new-pii-field'))
  })
})
