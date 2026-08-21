import { describe, expect, test } from 'bun:test'

import type { NetworkRequest } from 'hakka-core'

import { findExfiltrationFindings, formatExfiltrationReport } from '../exfiltration'

function req(overrides: Partial<NetworkRequest>): NetworkRequest {
  return {
    id: overrides.id ?? 'r1',
    url: overrides.url ?? 'https://api.example.com/users',
    method: overrides.method ?? 'GET',
    startTime: 0,
    ...overrides,
  }
}

describe('findExfiltrationFindings', () => {
  test('flags a sensitive field name sent to an unknown host', () => {
    const requests = [
      req({
        url: 'https://evil.example.com/collect',
        method: 'POST',
        requestBody: JSON.stringify({ apiKey: 'sk-abc123' }),
      }),
    ]
    const findings = findExfiltrationFindings(requests, { knownHosts: new Set(['api.example.com']) })
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ host: 'evil.example.com', severity: 'fail' })
    expect(findings[0]!.reason).toMatch(/apiKey/)
  })

  test('does not flag the same field sent to a known host', () => {
    const requests = [
      req({
        url: 'https://api.example.com/login',
        method: 'POST',
        requestBody: JSON.stringify({ apiKey: 'sk-abc123' }),
      }),
    ]
    const findings = findExfiltrationFindings(requests, { knownHosts: new Set(['api.example.com']) })
    expect(findings).toEqual([])
  })

  test('does not flag a new host with no sensitive-shaped data', () => {
    const requests = [req({ url: 'https://cdn.example.com/logo.png', requestBody: null })]
    const findings = findExfiltrationFindings(requests, { knownHosts: new Set(['api.example.com']) })
    expect(findings).toEqual([])
  })

  test('flags a sensitive query param on an unknown host', () => {
    const requests = [req({ url: 'https://evil.example.com/beacon?token=abc123' })]
    const findings = findExfiltrationFindings(requests, { knownHosts: new Set() })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.reason).toMatch(/query param/)
  })

  test('flags a JWT-shaped value in a request body on an unknown host', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzbm90YXJlYWxzaWduYXR1cmU'
    const requests = [req({ url: 'https://evil.example.com/x', method: 'POST', requestBody: `plain text ${jwt}` })]
    const findings = findExfiltrationFindings(requests, { knownHosts: new Set() })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.reason).toMatch(/JWT/)
  })

  test('flags an Authorization header sent to an unknown host', () => {
    const requests = [req({ url: 'https://evil.example.com/x', requestHeaders: { Authorization: 'Bearer abc123' } })]
    const findings = findExfiltrationFindings(requests, { knownHosts: new Set() })
    expect(findings).toHaveLength(1)
    expect(findings[0]!.reason).toMatch(/Authorization/)
  })

  test('does not flag a non-sensitive body sent to a new host (no entropy heuristic false positive)', () => {
    const requests = [
      req({
        url: 'https://cdn.example.com/track',
        method: 'POST',
        requestBody: JSON.stringify({ requestId: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6' }),
      }),
    ]
    const findings = findExfiltrationFindings(requests, { knownHosts: new Set() })
    expect(findings).toEqual([])
  })

  test('respects extraSensitiveFields', () => {
    const requests = [
      req({
        url: 'https://evil.example.com/x',
        method: 'POST',
        requestBody: JSON.stringify({ internalTicketId: 'abc' }),
      }),
    ]
    const findings = findExfiltrationFindings(requests, {
      knownHosts: new Set(),
      extraSensitiveFields: ['internalTicketId'],
    })
    expect(findings).toHaveLength(1)
  })
})

describe('formatExfiltrationReport', () => {
  test('reports a clean pass distinctly', () => {
    expect(formatExfiltrationReport([])).toMatch(/No exfiltration/)
  })

  test('output contains no ANSI escape codes', () => {
    const findings = findExfiltrationFindings(
      [req({ url: 'https://evil.example.com/x', requestHeaders: { Authorization: 'Bearer x' } })],
      { knownHosts: new Set() },
    )
    const report = formatExfiltrationReport(findings)
    // eslint-disable-next-line no-control-regex
    expect(/\x1b\[/.test(report)).toBe(false)
  })
})
