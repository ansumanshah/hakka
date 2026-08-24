import { describe, expect, test } from 'bun:test'

import { RECORD_SCHEMA_VERSION, RECORD_SEMCONV_VERSION, type NetworkRecord } from '../contract'
import { recordsToOtelJson } from '../otel'

const HEX16_RE = /^[0-9a-f]{16}$/
const HEX32_RE = /^[0-9a-f]{32}$/

function makeNetworkRecord(
  overrides: {
    status?: number | null
    error?: string | null
    duration?: number
    id?: string
    correlationId?: string
  } = {},
): NetworkRecord {
  return {
    id: overrides.id ?? 'rec-1',
    kind: 'network.request' as const,
    schemaVersion: RECORD_SCHEMA_VERSION,
    otelSemconvVersion: RECORD_SEMCONV_VERSION,
    timestamp: 1000000,
    tags: {},
    attributes: {},
    request: {
      id: 'req-1',
      url: 'https://api.example.com/v1/test',
      method: 'GET',
      startTime: 1000000,
      status: overrides.status !== undefined ? (overrides.status ?? undefined) : 200,
      error: overrides.error !== undefined ? (overrides.error ?? undefined) : undefined,
      duration: overrides.duration ?? 100,
      correlationId: overrides.correlationId,
    },
  }
}

function spanForRecord(record: NetworkRecord) {
  const result = recordsToOtelJson([record])
  return result.spans[0]
}

describe('networkRecordToSpan — status field', () => {
  test('status 200 → ok', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 200 }))
    expect(span?.status).toBe('ok')
  })

  test('status 201 → ok', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 201 }))
    expect(span?.status).toBe('ok')
  })

  test('status 301 → ok (redirect, not an error)', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 301 }))
    expect(span?.status).toBe('ok')
  })

  test('status 400 → error', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 400 }))
    expect(span?.status).toBe('error')
  })

  test('status 404 → error', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 404 }))
    expect(span?.status).toBe('error')
  })

  test('status 500 → error', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 500 }))
    expect(span?.status).toBe('error')
  })

  test('status null, no error → unset (pending/in-flight request)', () => {
    const span = spanForRecord(makeNetworkRecord({ status: null }))
    expect(span?.status).toBe('unset')
  })

  test('status undefined → unset', () => {
    const record = makeNetworkRecord({ status: 200 })
    // Override status to undefined to simulate missing status
    const withUndefinedStatus: NetworkRecord = {
      ...record,
      request: { ...record.request, status: undefined },
    }
    const span = spanForRecord(withUndefinedStatus)
    expect(span?.status).toBe('unset')
  })

  test('error present, status 200 → error (error takes precedence)', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 200, error: 'Network failure' }))
    expect(span?.status).toBe('error')
  })

  test('error present, status null → error (error wins over unset)', () => {
    const span = spanForRecord(makeNetworkRecord({ status: null, error: 'Timeout' }))
    expect(span?.status).toBe('error')
  })

  test('error is empty string (falsy) with status 200 → ok', () => {
    const span = spanForRecord(makeNetworkRecord({ status: 200, error: '' }))
    expect(span?.status).toBe('ok')
  })

  test('error is empty string, status null → unset', () => {
    const span = spanForRecord(makeNetworkRecord({ status: null, error: '' }))
    expect(span?.status).toBe('unset')
  })
})

describe('networkRecordToSpan — spanId/traceId format', () => {
  test('spanId is a valid 16-hex OTel span id, not the raw record id', () => {
    const span = spanForRecord(makeNetworkRecord({ id: 'network-abc123-uuid' }))
    expect(span?.spanId).not.toBe('network-abc123-uuid')
    expect(span?.spanId).toMatch(HEX16_RE)
  })

  test('the same record id always derives the same spanId', () => {
    const spanA = spanForRecord(makeNetworkRecord({ id: 'network-same-id' }))
    const spanB = spanForRecord(makeNetworkRecord({ id: 'network-same-id' }))
    expect(spanA?.spanId).toBe(spanB?.spanId)
  })

  test('traceId is populated from request.correlationId, as a valid 32-hex trace id', () => {
    const span = spanForRecord(makeNetworkRecord({ correlationId: '11111111-2222-3333-4444-555555555555' }))
    expect(span?.traceId).toBeDefined()
    expect(span?.traceId).toMatch(HEX32_RE)
    // A UUID correlationId derives to its dashes-stripped hex per deriveTraceId.
    expect(span?.traceId).toBe('11111111222233334444555555555555')
  })

  test('traceId is left undefined when the request has no correlationId', () => {
    const span = spanForRecord(makeNetworkRecord({}))
    expect(span?.traceId).toBeUndefined()
  })
})
