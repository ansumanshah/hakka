import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  RECORD_SEMCONV_VERSION,
  RECORD_SCHEMA_VERSION,
  type HealthReportRecord,
  type TraceRecord,
  networkRequestToRecord,
} from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

function fixture(name: string): unknown {
  const fixturePath = path.resolve(__dirname, '../../../..', 'fixtures/hakka-records/v1', name)
  return JSON.parse(readFileSync(fixturePath, 'utf8'))
}

describe('record contract', () => {
  const request: NetworkRequest = {
    id: 'request-1',
    url: 'https://api.example.com/users?token=redacted',
    method: 'POST',
    status: 201,
    startTime: 1_700_000_000_000,
    duration: 128,
    requestHeaders: { 'Content-Type': 'application/json' },
    responseHeaders: { 'Content-Type': 'application/json' },
    requestBodySize: 42,
    responseBodySize: 84,
    source: 'native',
    networkProtocol: 'h2',
    graphql: {
      operationType: 'mutation',
      operationName: 'CreateUser',
    },
  }

  it('wraps a network request in the canonical record envelope', () => {
    const record = networkRequestToRecord(request, {
      id: 'hakka-1',
      sessionId: 'session-1',
      tags: { tier: 'internal' },
      timestamp: 1_700_000_000_001,
    })

    expect(record).toMatchObject({
      id: 'hakka-1',
      kind: 'network.request',
      schemaVersion: RECORD_SCHEMA_VERSION,
      timestamp: 1_700_000_000_001,
      sessionId: 'session-1',
      tags: { tier: 'internal' },
      otelSemconvVersion: RECORD_SEMCONV_VERSION,
      request,
    })
  })

  it('emits OTel-semconv-shaped attributes without adding an OTel dependency', () => {
    const record = networkRequestToRecord(request, { id: 'hakka-1' })

    expect(record.attributes).toEqual({
      'http.request.method': 'POST',
      'url.full': 'https://api.example.com/users?token=redacted',
      'hakka.source': 'native',
      'http.response.status_code': '201',
      'network.protocol.name': 'h2',
      'hakka.duration_ms': '128',
      'graphql.operation.name': 'CreateUser',
    })
  })

  it('matches the shared network request golden fixture', () => {
    const record = networkRequestToRecord(request, {
      id: 'hakka-1',
      sessionId: 'session-1',
      tags: { tier: 'internal' },
      timestamp: 1_700_000_000_001,
    })

    expect(networkFixtureView(record)).toEqual(fixture('network-request.json'))
  })

  it.each<NonNullable<NetworkRequest['source']>>(['native', 'fetch', 'xhr', 'websocket'])(
    'uses the canonical %s source wire value',
    (source) => {
      const record = networkRequestToRecord({ ...request, source }, { id: 'hakka-1' })

      expect(record.attributes['hakka.source']).toBe(source)
    },
  )

  it('uses canonical trace and health field names', () => {
    const trace: TraceRecord = {
      id: 'trace-1',
      kind: 'trace',
      schemaVersion: RECORD_SCHEMA_VERSION,
      timestamp: 1000,
      name: 'checkout',
      traceId: 'trace-id',
      spanId: 'span-id',
      startTime: 1000,
      endTime: 1200,
    }
    const health: HealthReportRecord = {
      id: 'health-1',
      kind: 'health.report',
      schemaVersion: RECORD_SCHEMA_VERSION,
      timestamp: 1200,
      windowStart: 1000,
      windowEnd: 1200,
      totalRequests: 10,
      errorRate: 0.1,
    }

    expect(trace).toHaveProperty('startTime', 1000)
    expect(trace).toHaveProperty('endTime', 1200)
    expect(trace).not.toHaveProperty('startTimeMs')
    expect(health).toHaveProperty('windowStart', 1000)
    expect(health).toHaveProperty('windowEnd', 1200)
    expect(health).not.toHaveProperty('windowStartMs')
  })

  it('matches the shared trace golden fixture', () => {
    const trace: TraceRecord = {
      id: 'trace-1',
      kind: 'trace',
      schemaVersion: RECORD_SCHEMA_VERSION,
      timestamp: 1000,
      sessionId: 'session-1',
      tags: { tier: 'internal' },
      name: 'checkout',
      traceId: 'trace-id',
      spanId: 'span-id',
      parentSpanId: 'parent-span-id',
      startTime: 1000,
      endTime: 1200,
      attributes: { screen: 'Checkout' },
      status: 'ok',
    }

    expect(trace).toEqual(fixture('trace.json'))
  })

  it('matches the shared minimal trace golden fixture', () => {
    const trace: TraceRecord = {
      id: 'trace-minimal',
      kind: 'trace',
      schemaVersion: RECORD_SCHEMA_VERSION,
      timestamp: 1000,
      tags: {},
      name: 'checkout',
      traceId: 'trace-id',
      spanId: 'span-id',
      startTime: 1000,
      attributes: {},
    }

    expect(trace).toEqual(fixture('trace-minimal.json'))
  })

  it('matches the shared health report golden fixture', () => {
    const health: HealthReportRecord = {
      id: 'health-1',
      kind: 'health.report',
      schemaVersion: RECORD_SCHEMA_VERSION,
      timestamp: 1200,
      sessionId: 'session-1',
      tags: { tier: 'internal' },
      windowStart: 1000,
      windowEnd: 1200,
      totalRequests: 10,
      errorRate: 0.1,
      slowFrameRate: 0.05,
      frozenFrameCount: 1,
      summary: 'healthy',
    }

    expect(health).toEqual(fixture('health-report.json'))
  })

  it('matches the shared minimal health report golden fixture', () => {
    const health: HealthReportRecord = {
      id: 'health-minimal',
      kind: 'health.report',
      schemaVersion: RECORD_SCHEMA_VERSION,
      timestamp: 1200,
      tags: {},
      windowStart: 1000,
      windowEnd: 1200,
      totalRequests: 10,
      errorRate: 0.1,
    }

    expect(health).toEqual(fixture('health-report-minimal.json'))
  })
})

function networkFixtureView(record: ReturnType<typeof networkRequestToRecord>) {
  const request = record.request

  return {
    id: record.id,
    kind: record.kind,
    schemaVersion: record.schemaVersion,
    timestamp: record.timestamp,
    sessionId: record.sessionId,
    tags: record.tags,
    otelSemconvVersion: record.otelSemconvVersion,
    request: {
      id: request.id,
      url: request.url,
      method: request.method,
      status: request.status,
      startTime: request.startTime,
      duration: request.duration,
      requestBodySize: request.requestBodySize,
      responseBodySize: request.responseBodySize,
      source: request.source,
      networkProtocol: request.networkProtocol,
      graphqlOperationName: request.graphql?.operationName,
    },
    attributes: record.attributes,
  }
}
