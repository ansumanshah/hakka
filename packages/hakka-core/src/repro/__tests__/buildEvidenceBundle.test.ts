import { describe, expect, test } from 'bun:test'

import { analyzeRequests } from '../../analyze/analyzeRequests'
import type { LogEntry } from '../../log/types'
import type { FrameworkSpan, NetworkRequest } from '../../model/types'
import { summarizeTraceGroup } from '../../query/traceSummary'
import { assembleTraceTree } from '../../query/traceTree'
import { buildEvidenceBundle, EVIDENCE_BUNDLE_SCHEMA_VERSION } from '../buildEvidenceBundle'
import { buildReproBundle } from '../buildReproBundle'

const EXPORTED_AT = '2026-01-01T00:00:00.000Z'
const encoder = new TextEncoder()

function byteSize(x: unknown): number {
  return encoder.encode(JSON.stringify(x)).length
}

function req(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://api.example.com/users/1',
    method: 'GET',
    status: 200,
    startTime: 0,
    endTime: 10,
    ...overrides,
  }
}

function span(overrides: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id: 'span-1',
    traceId: 't1',
    parentId: null,
    name: 'op',
    startTime: 0,
    endTime: 5,
    verbosity: 'verbose',
    runtime: 'server',
    ...overrides,
  }
}

function logEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'log-1',
    timestamp: 0,
    level: 'info',
    message: 'a log line',
    ...overrides,
  }
}

/** Same ordering the implementation uses (startTime asc, id tie-break) — replicated here so tests can assert against direct calls on "the same input". */
function sortForBundle(requests: NetworkRequest[]): NetworkRequest[] {
  return [...requests].sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

describe('buildEvidenceBundle — determinism', () => {
  test('same input + same exportedAt produces byte-identical JSON.stringify output', () => {
    const requests = [
      req({ id: 'a', startTime: 5 }),
      req({ id: 'b', startTime: 1, url: 'https://api.example.com/orders/9', method: 'POST' }),
    ]
    const spans = [span({ id: 's1' }), span({ id: 's2', verbosity: 'primary' })]
    const logs = [logEntry({ id: 'l1', timestamp: 3 })]

    const b1 = buildEvidenceBundle(requests, { spans, logs, exportedAt: EXPORTED_AT })
    const b2 = buildEvidenceBundle(requests, { spans, logs, exportedAt: EXPORTED_AT })

    expect(JSON.stringify(b1)).toBe(JSON.stringify(b2))
  })

  test('stamps the current schema version', () => {
    const b = buildEvidenceBundle([req()], { exportedAt: EXPORTED_AT })
    expect(b.version).toBe(EVIDENCE_BUNDLE_SCHEMA_VERSION)
  })

  test('exportedAt defaults to an ISO string when not provided', () => {
    const b = buildEvidenceBundle([req()])
    expect(() => new Date(b.exportedAt).toISOString()).not.toThrow()
  })
})

describe('buildEvidenceBundle — defaults, no truncation pressure', () => {
  test('storage is always null', () => {
    const b = buildEvidenceBundle([req()], { exportedAt: EXPORTED_AT })
    expect(b.storage).toBeNull()
  })

  test('truncations is [] when well under budget', () => {
    const b = buildEvidenceBundle([req()], { exportedAt: EXPORTED_AT })
    expect(b.truncations).toEqual([])
  })

  test('focusRequestId defaults to requests[0].id after sort', () => {
    const requests = [req({ id: 'later', startTime: 10 }), req({ id: 'earlier', startTime: 1 })]
    const b = buildEvidenceBundle(requests, { exportedAt: EXPORTED_AT })
    expect(b.focusRequestId).toBe('earlier')
  })

  test('explicit focusRequestId is honored', () => {
    const requests = [req({ id: 'a', startTime: 1 }), req({ id: 'b', startTime: 2 })]
    const b = buildEvidenceBundle(requests, { focusRequestId: 'b', exportedAt: EXPORTED_AT })
    expect(b.focusRequestId).toBe('b')
  })

  test('empty requests -> traceSummary: null, no throw', () => {
    expect(() => buildEvidenceBundle([], { exportedAt: EXPORTED_AT })).not.toThrow()
    const b = buildEvidenceBundle([], { exportedAt: EXPORTED_AT })
    expect(b.traceSummary).toBeNull()
    expect(b.requests).toEqual([])
    expect(b.truncations).toEqual([])
  })

  test('calls (not reimplements) buildReproBundle / assembleTraceTree / analyzeRequests for the same sorted input', () => {
    const requests = [
      req({ id: 'a', startTime: 5, url: 'https://api.example.com/a' }),
      req({ id: 'b', startTime: 1, url: 'https://api.example.com/b', status: 500 }),
    ]
    const spans = [span({ id: 's1', verbosity: 'primary' }), span({ id: 's2', verbosity: 'verbose' })]
    const sorted = sortForBundle(requests)

    const b = buildEvidenceBundle(requests, { spans, exportedAt: EXPORTED_AT })

    expect(b.mocks).toEqual(buildReproBundle(sorted).mocks)
    expect(b.trace).toEqual(assembleTraceTree(sorted, spans, { verbose: true }))
    expect(b.diagnosis).toEqual(analyzeRequests(sorted))
    expect(b.traceSummary).toEqual(summarizeTraceGroup(sorted, spans))
  })

  test('an explicit diagnosis option bypasses analyzeRequests', () => {
    const custom = { total: 0, failed: 0, slowest: [], findings: [], summary: 'custom' }
    const b = buildEvidenceBundle([req()], { diagnosis: custom, exportedAt: EXPORTED_AT })
    expect(b.diagnosis).toBe(custom)
  })
})

describe('buildEvidenceBundle — console correlation (time-window, not a join key)', () => {
  test('keeps a log entry inside the request window', () => {
    const requests = [req({ startTime: 0, endTime: 100 })]
    const logs = [logEntry({ timestamp: 50 })]
    const b = buildEvidenceBundle(requests, { logs, exportedAt: EXPORTED_AT })
    expect(b.console).toEqual(logs)
  })

  test('drops a log entry outside the padded window', () => {
    const requests = [req({ startTime: 0, endTime: 100 })]
    const logs = [logEntry({ timestamp: 100_000 })]
    const b = buildEvidenceBundle(requests, { logs, logWindowMs: 10, exportedAt: EXPORTED_AT })
    expect(b.console).toEqual([])
  })

  test('honors a wider logWindowMs to keep entries just outside the tight default', () => {
    const requests = [req({ startTime: 0, endTime: 100 })]
    const logs = [logEntry({ timestamp: 200 })]
    const tight = buildEvidenceBundle(requests, { logs, logWindowMs: 10, exportedAt: EXPORTED_AT })
    const wide = buildEvidenceBundle(requests, { logs, logWindowMs: 500, exportedAt: EXPORTED_AT })
    expect(tight.console).toEqual([])
    expect(wide.console).toEqual(logs)
  })
})

// Truncation passes — each fixture is tuned so exactly one pass has anything
// to cut; maxBytes is computed as "the fixture's untruncated size minus one
// byte", not hardcoded, so these stay correct if unrelated fields change size.
describe('buildEvidenceBundle — truncation passes', () => {
  test('pass 1: spans.verbose.dropped', () => {
    const requests = [req({ startTime: 0, endTime: 100 })]
    const spans = Array.from({ length: 30 }, (_, i) =>
      span({ id: `s${i}`, startTime: i, endTime: i + 1, verbosity: 'verbose' }),
    )
    const full = buildEvidenceBundle(requests, { spans, exportedAt: EXPORTED_AT, maxBytes: Number.MAX_SAFE_INTEGER })
    const b = buildEvidenceBundle(requests, { spans, exportedAt: EXPORTED_AT, maxBytes: byteSize(full) - 1 })

    expect(b.truncations).toHaveLength(1)
    expect(b.truncations[0]?.kind).toBe('spans.verbose.dropped')
    expect(b.truncations[0]?.detail.length).toBeGreaterThan(0)
    expect(b.truncations[0]?.bytesSaved).toBeGreaterThan(0)
    expect(b.trace.bars.some((bar) => bar.kind === 'span')).toBe(false)
  })

  test('pass 2: console.trimmed', () => {
    const requests = [req({ startTime: 0, endTime: 1000 })]
    const logs = Array.from({ length: 30 }, (_, i) => logEntry({ id: `l${i}`, timestamp: i }))
    const full = buildEvidenceBundle(requests, { logs, exportedAt: EXPORTED_AT, maxBytes: Number.MAX_SAFE_INTEGER })
    const b = buildEvidenceBundle(requests, { logs, exportedAt: EXPORTED_AT, maxBytes: byteSize(full) - 1 })

    expect(b.truncations).toHaveLength(1)
    expect(b.truncations[0]?.kind).toBe('console.trimmed')
    expect(b.truncations[0]?.detail.length).toBeGreaterThan(0)
    expect(b.truncations[0]?.bytesSaved).toBeGreaterThan(0)
    expect(b.console.length).toBeLessThan(logs.length)
    expect(b.console.length).toBeGreaterThan(0)
  })

  test('pass 3: diagnose.findings.capped', () => {
    const requests = Array.from({ length: 10 }, (_, i) =>
      req({ id: `r${i}`, startTime: i, endTime: i + 1, status: 500, url: `https://api.example.com/fail/${i}` }),
    )
    const full = buildEvidenceBundle(requests, { exportedAt: EXPORTED_AT, maxBytes: Number.MAX_SAFE_INTEGER })
    expect(full.diagnosis.findings.length).toBeGreaterThan(1)
    const b = buildEvidenceBundle(requests, { exportedAt: EXPORTED_AT, maxBytes: byteSize(full) - 1 })

    expect(b.truncations).toHaveLength(1)
    expect(b.truncations[0]?.kind).toBe('diagnose.findings.capped')
    expect(b.truncations[0]?.detail.length).toBeGreaterThan(0)
    expect(b.truncations[0]?.bytesSaved).toBeGreaterThan(0)
    expect(b.diagnosis.findings.length).toBeLessThan(full.diagnosis.findings.length)
  })

  test('pass 4: requests.body.trimmed (non-focal bodies blanked, focal untouched)', () => {
    const bigBody = 'y'.repeat(300)
    const requests = [
      req({ id: 'focal', startTime: 0, endTime: 1, requestBody: null, responseBody: null, status: null }),
      ...Array.from({ length: 5 }, (_, i) =>
        req({
          id: `other-${i}`,
          startTime: i + 1,
          endTime: i + 2,
          requestBody: bigBody,
          responseBody: bigBody,
          status: null,
        }),
      ),
    ]
    const opts = { focusRequestId: 'focal', exportedAt: EXPORTED_AT }
    const full = buildEvidenceBundle(requests, { ...opts, maxBytes: Number.MAX_SAFE_INTEGER })
    const b = buildEvidenceBundle(requests, { ...opts, maxBytes: byteSize(full) - 1 })

    expect(b.truncations).toHaveLength(1)
    expect(b.truncations[0]?.kind).toBe('requests.body.trimmed')
    expect(b.truncations[0]?.bytesSaved).toBeGreaterThan(0)
    for (const r of b.requests) {
      if (r.id !== 'focal') {
        expect(r.requestBody).toBeNull()
        expect(r.responseBody).toBeNull()
      }
    }
  })

  test('pass 5: mocks.dropped', () => {
    const requests = [req({ startTime: 0, endTime: 1, status: 200, responseBody: '{"ok":true}' })]
    const full = buildEvidenceBundle(requests, { exportedAt: EXPORTED_AT, maxBytes: Number.MAX_SAFE_INTEGER })
    expect(full.mocks.length).toBeGreaterThan(0)
    const b = buildEvidenceBundle(requests, { exportedAt: EXPORTED_AT, maxBytes: byteSize(full) - 1 })

    expect(b.truncations).toHaveLength(1)
    expect(b.truncations[0]?.kind).toBe('mocks.dropped')
    expect(b.truncations[0]?.bytesSaved).toBeGreaterThan(0)
    expect(b.mocks).toEqual([])
  })

  test('pass 6: requests.nonfocal.dropped (focal request survives)', () => {
    const requests = [
      req({ id: 'focal', startTime: 0, endTime: 1, requestBody: null, responseBody: null, status: null }),
      ...Array.from({ length: 8 }, (_, i) =>
        req({
          id: `other-${i}`,
          startTime: i + 1,
          endTime: i + 2,
          status: null,
          responseBody: null,
          url: `https://api.example.com/nonfocal/${i}`,
        }),
      ),
    ]
    const opts = { focusRequestId: 'focal', exportedAt: EXPORTED_AT }
    const full = buildEvidenceBundle(requests, { ...opts, maxBytes: Number.MAX_SAFE_INTEGER })
    const b = buildEvidenceBundle(requests, { ...opts, maxBytes: byteSize(full) - 1 })

    expect(b.truncations).toHaveLength(1)
    expect(b.truncations[0]?.kind).toBe('requests.nonfocal.dropped')
    expect(b.truncations[0]?.bytesSaved).toBeGreaterThan(0)
    expect(b.requests).toHaveLength(1)
    expect(b.requests[0]?.id).toBe('focal')
  })

  test('pass 7: focal.body.hard-truncate (last resort, focal always keeps some signal)', () => {
    const bigBody = 'z'.repeat(1000)
    const requests = [
      req({ id: 'focal', startTime: 0, endTime: 1, requestBody: bigBody, responseBody: null, status: null }),
    ]
    const opts = { focusRequestId: 'focal', exportedAt: EXPORTED_AT }
    const full = buildEvidenceBundle(requests, { ...opts, maxBytes: Number.MAX_SAFE_INTEGER })
    const b = buildEvidenceBundle(requests, { ...opts, maxBytes: byteSize(full) - 1 })

    expect(b.truncations).toHaveLength(1)
    expect(b.truncations[0]?.kind).toBe('focal.body.hard-truncate')
    expect(b.truncations[0]?.bytesSaved).toBeGreaterThan(0)
    expect(b.requests).toHaveLength(1)
    expect(b.requests[0]?.id).toBe('focal')
    expect(b.requests[0]?.requestBody?.length ?? 0).toBeLessThan(bigBody.length)
    expect(b.requests[0]?.requestBody?.length ?? 0).toBeGreaterThan(0)
  })

  test('focusRequestId is never dropped even when maxBytes forces every other request out', () => {
    const bigBody = 'w'.repeat(500)
    const requests = [
      req({ id: 'focal', startTime: 0, endTime: 1, requestBody: bigBody, responseBody: bigBody, status: 200 }),
      ...Array.from({ length: 5 }, (_, i) =>
        req({
          id: `other-${i}`,
          startTime: i + 1,
          endTime: i + 2,
          requestBody: bigBody,
          responseBody: bigBody,
          status: 200,
        }),
      ),
    ]
    const spans = [span({ id: 's1' })]
    const logs = [logEntry({ id: 'l1', timestamp: 0 })]
    const b = buildEvidenceBundle(requests, {
      focusRequestId: 'focal',
      spans,
      logs,
      exportedAt: EXPORTED_AT,
      maxBytes: 1,
    })

    expect(b.requests.some((r) => r.id === 'focal')).toBe(true)
  })

  test('an unmatched focusRequestId falls back to the sorted default instead of emptying the bundle under budget pressure', () => {
    const bigBody = 'w'.repeat(500)
    const requests = [
      req({ id: 'a', startTime: 0, endTime: 1, requestBody: bigBody, responseBody: bigBody, status: 200 }),
      req({ id: 'b', startTime: 1, endTime: 2, requestBody: bigBody, responseBody: bigBody, status: 200 }),
    ]
    const b = buildEvidenceBundle(requests, {
      focusRequestId: 'does-not-exist',
      exportedAt: EXPORTED_AT,
      maxBytes: 1,
    })

    // Falls back to the earliest request in sorted order (id 'a'), not the
    // bogus id — so it survives pass 6 (drop non-focal requests) instead of
    // every request being treated as non-focal and the bundle ending up empty.
    expect(b.focusRequestId).toBe('a')
    expect(b.requests.length).toBeGreaterThan(0)
    expect(b.requests.some((r) => r.id === 'a')).toBe(true)
    const fallback = b.truncations.find((t) => t.kind === 'focusRequestId.not-found.fallback')
    expect(fallback).toBeDefined()
    expect(fallback?.detail).toContain('does-not-exist')
  })

  test('an unmatched focusRequestId with an empty requests array falls back to the empty string, not a crash', () => {
    const b = buildEvidenceBundle([], { focusRequestId: 'does-not-exist', exportedAt: EXPORTED_AT })

    expect(b.focusRequestId).toBe('')
    expect(b.requests).toHaveLength(0)
    const fallback = b.truncations.find((t) => t.kind === 'focusRequestId.not-found.fallback')
    expect(fallback).toBeDefined()
  })
})

describe('buildEvidenceBundle — share-time scrubbing (default on)', () => {
  const SECRET = 'sk-live-abcdef0123456789'

  function secretRequest(): NetworkRequest {
    return req({
      url: `https://api.example.com/chat?api_key=${SECRET}`,
      requestHeaders: { Authorization: `Bearer ${SECRET}`, Cookie: `session=${SECRET}` },
      requestBody: JSON.stringify({ password: SECRET, nested: { token: SECRET } }),
      responseBody: JSON.stringify({ ok: true }),
    })
  }

  test('a secret in a header, JSON body field, query string, cookie, and nested body object does not appear anywhere in the serialized bundle by default', () => {
    const b = buildEvidenceBundle([secretRequest()], { exportedAt: EXPORTED_AT })
    expect(JSON.stringify(b)).not.toContain(SECRET)
    expect(b.redaction.applied).toBe(true)
    expect(b.redaction.removed.length).toBeGreaterThan(0)
  })

  test('mocks derived from the requests are also scrubbed, not just the requests list', () => {
    const b = buildEvidenceBundle([secretRequest()], { exportedAt: EXPORTED_AT })
    expect(JSON.stringify(b.mocks)).not.toContain(SECRET)
  })

  test('scrub: false opts out explicitly and the secret survives, with redaction.applied false', () => {
    const b = buildEvidenceBundle([secretRequest()], { exportedAt: EXPORTED_AT, scrub: false })
    expect(JSON.stringify(b)).toContain(SECRET)
    expect(b.redaction).toEqual({ applied: false, removed: [] })
  })

  test('a clean request reports redaction.applied true with an empty removed list', () => {
    const b = buildEvidenceBundle([req({ requestBody: JSON.stringify({ id: 1 }) })], { exportedAt: EXPORTED_AT })
    expect(b.redaction).toEqual({ applied: true, removed: [] })
  })
})
