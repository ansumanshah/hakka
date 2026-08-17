import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from '../../model/types'
import { toAgentContext } from '../agentContext'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/v1/items',
    method: 'GET',
    status: 200,
    startTime: 0,
    duration: 120,
    ...overrides,
  }
}

describe('toAgentContext', () => {
  test('includes the analysis summary header', () => {
    const ctx = toAgentContext([makeRequest()])
    expect(ctx).toContain('# Hakka agent context')
    expect(ctx).toContain('1 request')
  })

  test('includes a dense request line with method, path, status, duration', () => {
    const ctx = toAgentContext([makeRequest({ url: 'https://api.example.com/v1/items?x=1', duration: 250 })])
    expect(ctx).toContain('GET /v1/items?x=1 -> 200 250ms')
  })

  test('includes findings section when there are failures', () => {
    const ctx = toAgentContext([makeRequest({ status: 401, url: 'https://api.example.com/login' })])
    expect(ctx).toContain('## Findings')
    expect(ctx).toContain('401')
  })

  test('omits findings section when there are none', () => {
    const ctx = toAgentContext([makeRequest()])
    expect(ctx).not.toContain('## Findings')
  })

  test('includes slowest section when a request exceeds the slow threshold', () => {
    const ctx = toAgentContext([makeRequest({ duration: 2000 })], { slowMs: 1000 })
    expect(ctx).toContain('## Slowest')
  })

  test('includes an allowlisted header on the request line', () => {
    const ctx = toAgentContext([makeRequest({ responseHeaders: { 'Content-Type': 'application/json' } })])
    expect(ctx).toContain('Content-Type: application/json')
  })

  test('does not include a non-allowlisted header', () => {
    const ctx = toAgentContext([makeRequest({ responseHeaders: { 'X-Trace-Id': 'abc123' } })])
    expect(ctx).not.toContain('X-Trace-Id')
  })

  test('includes a short body snippet', () => {
    const ctx = toAgentContext([makeRequest({ method: 'POST', requestBody: '{"email":"a@b.com"}' })])
    expect(ctx).toContain('body:')
    expect(ctx).toContain('email')
  })

  test('truncates a long body snippet', () => {
    const longBody = 'x'.repeat(500)
    const ctx = toAgentContext([makeRequest({ method: 'POST', requestBody: longBody })], { bodySnippetLength: 20 })
    expect(ctx).toContain('…')
    expect(ctx).not.toContain('x'.repeat(500))
  })

  test('[REDACTED] header/body values pass through as literal text', () => {
    const ctx = toAgentContext([
      makeRequest({
        method: 'POST',
        requestHeaders: { Authorization: '[REDACTED]' },
        requestBody: '{"password":"[REDACTED]"}',
      }),
    ])
    expect(ctx).toContain('[REDACTED]')
  })

  test('caps the number of requests listed and reports the total', () => {
    const requests = Array.from({ length: 5 }, (_, i) => makeRequest({ id: `req-${i}`, url: `https://x.com/${i}` }))
    const ctx = toAgentContext(requests, { maxRequests: 2 })
    expect(ctx).toContain('## Requests (2/5)')
  })

  test('handles an empty request list', () => {
    const ctx = toAgentContext([])
    expect(ctx).toContain('No requests captured yet')
  })
})
