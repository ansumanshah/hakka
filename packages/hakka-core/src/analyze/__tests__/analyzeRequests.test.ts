import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { analyzeRequests } from '../analyzeRequests'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: over.id ?? 'r1',
    url: over.url ?? 'https://api.example.com/users',
    method: over.method ?? 'GET',
    status: over.status ?? 200,
    ...over,
  }
}

describe('analyzeRequests', () => {
  test('empty input', () => {
    const d = analyzeRequests([])
    expect(d.total).toBe(0)
    expect(d.failed).toBe(0)
    expect(d.summary).toBe('No requests captured yet.')
  })

  test('5xx is an error-severity failure; 401 is an auth warning', () => {
    const d = analyzeRequests([
      req({
        id: 'a',
        url: 'https://api.example.com/pay',
        method: 'POST',
        status: 500,
        responseBody: '{"error":"boom"}',
      }),
      req({ id: 'b', url: 'https://api.example.com/me', status: 401 }),
    ])
    expect(d.failed).toBe(2)
    const a = d.findings.find((f) => f.requestId === 'a')!
    expect(a.severity).toBe('error')
    expect(a.kind).toBe('failure')
    expect(a.message).toContain('server error')
    expect(a.message).toContain('boom')
    const b = d.findings.find((f) => f.requestId === 'b')!
    expect(b.severity).toBe('warning')
    expect(b.kind).toBe('auth')
    // errors rank before warnings
    expect(d.findings.indexOf(a)).toBeLessThan(d.findings.indexOf(b))
  })

  test('slow request flagged; fast one not', () => {
    const d = analyzeRequests([req({ id: 'slow', duration: 1800 }), req({ id: 'fast', duration: 40 })], {
      slowMs: 1000,
    })
    expect(d.findings.some((f) => f.kind === 'slow' && f.requestId === 'slow')).toBe(true)
    expect(d.findings.some((f) => f.kind === 'slow' && f.requestId === 'fast')).toBe(false)
    expect(d.slowest[0]?.id).toBe('slow')
    expect(d.slowest[0]?.durationMs).toBe(1800)
  })

  test('plaintext secret in body flagged; redacted value is not', () => {
    const leaked = analyzeRequests([
      req({
        id: 'l',
        method: 'POST',
        url: 'https://api.example.com/login',
        requestBody: '{"user":"x","password":"hunter2"}',
      }),
    ])
    expect(leaked.findings.some((f) => f.kind === 'secret-in-body')).toBe(true)

    const safe = analyzeRequests([
      req({
        id: 's',
        method: 'POST',
        url: 'https://api.example.com/login',
        requestBody: '{"user":"x","password":"[REDACTED]"}',
      }),
    ])
    expect(safe.findings.some((f) => f.kind === 'secret-in-body')).toBe(false)
  })

  test('oversized response + uncacheable GET', () => {
    const d = analyzeRequests([
      req({ id: 'big', responseBodySize: 3_000_000, responseHeaders: { 'cache-control': 'no-store' } }),
      req({ id: 'nocache', status: 200, responseHeaders: { 'content-type': 'application/json' } }),
    ])
    expect(d.findings.some((f) => f.kind === 'oversized' && f.requestId === 'big')).toBe(true)
    expect(d.findings.some((f) => f.kind === 'uncacheable' && f.requestId === 'nocache')).toBe(true)
  })

  test('repeated identical request flagged as possible N+1', () => {
    const many = Array.from({ length: 6 }, (_, i) => req({ id: `n${i}`, url: 'https://api.example.com/item' }))
    const d = analyzeRequests(many, { repeatedThreshold: 4 })
    expect(d.findings.some((f) => f.kind === 'repeated')).toBe(true)
  })

  test('summary clusters failures by host', () => {
    const d = analyzeRequests([
      req({ id: 'a', url: 'https://pay.example.com/x', status: 500 }),
      req({ id: 'b', url: 'https://pay.example.com/y', status: 502 }),
      req({ id: 'c', url: 'https://ok.example.com/z', status: 200 }),
    ])
    expect(d.summary).toContain('3 requests')
    expect(d.summary).toContain('2 failed')
    expect(d.summary).toContain('pay.example.com')
  })
})
