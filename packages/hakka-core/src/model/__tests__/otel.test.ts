import { describe, expect, test } from 'bun:test'

import { RECORD_SCHEMA_VERSION, RECORD_SEMCONV_VERSION, type NetworkRecord } from '../contract'
import { recordsToOtelJson } from '../otel'

const HEX16_RE = /^[0-9a-f]{16}$/

function makeNetworkRecord(
  overrides: {
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
      status: 200,
      duration: 100,
      correlationId: overrides.correlationId,
    },
  }
}

function spanForRecord(record: NetworkRecord) {
  const result = recordsToOtelJson([record])
  return result.spans[0]
}

describe('networkRecordToSpan status', () => {
  test.each([
    [200, undefined, 'ok'],
    [201, undefined, 'ok'],
    [301, undefined, 'ok'],
    [400, undefined, 'error'],
    [404, undefined, 'error'],
    [500, undefined, 'error'],
    [null, undefined, 'unset'],
    [undefined, undefined, 'unset'],
    [200, 'Network failure', 'error'],
    [null, 'Timeout', 'error'],
    [200, '', 'ok'],
    [null, '', 'unset'],
  ] as const)('status %s, error %s -> %s', (status, error, expected) => {
    const record = makeNetworkRecord()
    const span = spanForRecord({ ...record, request: { ...record.request, status, error } })
    expect(span?.status).toBe(expected)
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
    expect(span?.traceId).toBe('11111111222233334444555555555555')
  })

  test('traceId is left undefined when the request has no correlationId', () => {
    const span = spanForRecord(makeNetworkRecord({}))
    expect(span?.traceId).toBeUndefined()
  })
})
