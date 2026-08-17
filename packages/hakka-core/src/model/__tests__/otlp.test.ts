import { describe, expect, test } from 'bun:test'

import { RECORD_SCHEMA_VERSION, RECORD_SEMCONV_VERSION, type NetworkRecord } from '../contract'
import type { OtelJsonExport } from '../otel'
import { pushOtlp, toOtlpLogs, toOtlpMetrics, toOtlpTraces } from '../otlp'

function networkRecord(status = 200): NetworkRecord {
  return {
    id: 'rec-1',
    kind: 'network.request',
    schemaVersion: RECORD_SCHEMA_VERSION,
    otelSemconvVersion: RECORD_SEMCONV_VERSION,
    timestamp: 1_000_000,
    tags: {},
    attributes: {},
    request: {
      id: 'req-1',
      url: 'https://api.example.com/v1/test',
      method: 'GET',
      startTime: 1_000_000,
      status,
      duration: 100,
    },
  }
}

// Hand-built export exercising all three signal transforms.
const EXPORT: OtelJsonExport = {
  schemaVersion: RECORD_SCHEMA_VERSION,
  otelSemconvVersion: RECORD_SEMCONV_VERSION,
  resource: { attributes: [{ key: 'service.name', value: 'demo' }] },
  scope: { name: 'hakka', version: '1' },
  spans: [
    {
      spanId: 'a1',
      name: 'GET /x',
      kind: 'client',
      startTimeUnixNano: '1000',
      endTimeUnixNano: '2000',
      attributes: [{ key: 'http.status', value: 200 }],
      status: 'ok',
    },
  ],
  metricPoints: [
    { name: 'app.fps', unit: '1', timeUnixNano: '1000', value: 59.9, attributes: [{ key: 'ok', value: true }] },
    { name: 'app.fps', unit: '1', timeUnixNano: '2000', value: 58.1, attributes: [] },
    { name: 'app.memory', unit: 'By', timeUnixNano: '1000', value: 1024, attributes: [] },
  ],
  logs: [
    {
      timeUnixNano: '1500',
      severityText: 'WARN',
      body: 'slow frame',
      attributes: [{ key: 'category', value: 'perf' }],
    },
  ],
}

describe('toOtlpTraces', () => {
  test('nests resource/scope/spans with OTLP span kind + status code + KeyValue attrs', () => {
    const p = toOtlpTraces(EXPORT)
    const rs = p.resourceSpans[0]
    expect(rs.resource.attributes[0]).toEqual({ key: 'service.name', value: { stringValue: 'demo' } })
    const span = rs.scopeSpans[0].spans[0] as Record<string, unknown>
    expect(span.kind).toBe(3) // CLIENT
    expect(span.status).toEqual({ code: 1 }) // OK
    expect(span.attributes).toEqual([{ key: 'http.status', value: { intValue: '200' } }])
  })
})

describe('toOtlpMetrics', () => {
  test('groups points by name into gauges; encodes bool + int/double values', () => {
    const p = toOtlpMetrics(EXPORT)
    const metrics = p.resourceMetrics[0].scopeMetrics[0].metrics as Array<Record<string, any>>
    expect(metrics.length).toBe(2) // app.fps (2 points) + app.memory (1)
    const fps = metrics.find((m) => m.name === 'app.fps')
    expect(fps.gauge.dataPoints.length).toBe(2)
    expect(fps.gauge.dataPoints[0].asDouble).toBe(59.9)
    expect(fps.gauge.dataPoints[0].attributes[0]).toEqual({ key: 'ok', value: { boolValue: true } })
    const mem = metrics.find((m) => m.name === 'app.memory')
    expect(mem.unit).toBe('By')
    expect(mem.gauge.dataPoints[0].asDouble).toBe(1024)
  })
})

describe('toOtlpLogs', () => {
  test('maps severityText → severityNumber and wraps body', () => {
    const p = toOtlpLogs(EXPORT)
    const rec = p.resourceLogs[0].scopeLogs[0].logRecords[0] as Record<string, unknown>
    expect(rec.severityNumber).toBe(13) // WARN
    expect(rec.body).toEqual({ stringValue: 'slow frame' })
  })
})

describe('pushOtlp', () => {
  test('POSTs only non-empty signals to /v1/{traces,metrics,logs} with _noHakka + headers', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return { ok: true, status: 200 } as Response
    }) as unknown as typeof fetch

    const res = await pushOtlp([networkRecord(200)], {
      endpoint: 'http://localhost:4318/',
      headers: { authorization: 'Bearer t' },
      fetchImpl: fakeFetch,
    })

    // A network record yields a span only (no metrics/logs) → one POST to /v1/traces.
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('http://localhost:4318/v1/traces')
    expect((calls[0].init as { _noHakka?: boolean })._noHakka).toBe(true)
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer t')
    expect(res.traces).toEqual({ ok: true, status: 200 })
    expect(res.metrics).toBeUndefined()
    expect(res.logs).toBeUndefined()
  })

  test('captures a collector failure instead of throwing', async () => {
    const fakeFetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const res = await pushOtlp([networkRecord(200)], { endpoint: 'http://localhost:4318', fetchImpl: fakeFetch })
    expect(res.traces?.ok).toBe(false)
    expect(res.traces?.error).toContain('ECONNREFUSED')
  })
})
