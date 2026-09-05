import type { Exporter } from '../contract/exporter'
import { deriveTraceId } from '../engine/traceparent'
import {
  RECORD_SCHEMA_VERSION,
  RECORD_SEMCONV_VERSION,
  networkRequestToRecord,
  type Attributes,
  type BreadcrumbRecord,
  type ContractRecord,
  type CpuMetricRecord,
  type FrameMetricRecord,
  type HealthReportRecord,
  type JsThreadMetricRecord,
  type MemoryMetricRecord,
  type NetworkRecord,
  type NetworkUsageMetricRecord,
  type TraceRecord,
} from './contract'

export interface OtelExportOptions {
  readonly serviceName?: string
  readonly serviceVersion?: string
  readonly scopeName?: string
  readonly scopeVersion?: string
  readonly resourceAttributes?: Attributes
}

export interface OtelAttribute {
  readonly key: string
  readonly value: string | number | boolean
}

export interface OtelResource {
  readonly attributes: readonly OtelAttribute[]
}

export interface OtelScope {
  readonly name: string
  readonly version?: string
}

export interface OtelSpan {
  readonly traceId?: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly name: string
  readonly kind: 'client' | 'internal'
  readonly startTimeUnixNano: string
  readonly endTimeUnixNano?: string
  readonly attributes: readonly OtelAttribute[]
  readonly status?: 'ok' | 'error' | 'unset'
}

export interface OtelMetricPoint {
  readonly name: string
  readonly unit: string
  readonly timeUnixNano: string
  readonly value: number
  readonly attributes: readonly OtelAttribute[]
}

export interface OtelLogRecord {
  readonly timeUnixNano: string
  readonly severityText: 'INFO' | 'WARN' | 'ERROR'
  readonly body: string
  readonly attributes: readonly OtelAttribute[]
}

export interface OtelJsonExport {
  readonly schemaVersion: typeof RECORD_SCHEMA_VERSION
  readonly otelSemconvVersion: typeof RECORD_SEMCONV_VERSION
  readonly resource: OtelResource
  readonly scope: OtelScope
  readonly spans: readonly OtelSpan[]
  readonly metricPoints: readonly OtelMetricPoint[]
  readonly logs: readonly OtelLogRecord[]
}

const DEFAULT_SCOPE_NAME = 'hakka'

export function recordsToOtelJson(records: readonly ContractRecord[], options: OtelExportOptions = {}): OtelJsonExport {
  const spans: OtelSpan[] = []
  const metricPoints: OtelMetricPoint[] = []
  const logs: OtelLogRecord[] = []

  for (const record of records) {
    switch (record.kind) {
      case 'network.request':
        spans.push(networkRecordToSpan(record))
        break
      case 'trace':
        spans.push(traceRecordToSpan(record))
        break
      case 'metric.frame':
        metricPoints.push(...frameMetricPoints(record))
        break
      case 'metric.memory':
        metricPoints.push(...memoryMetricPoints(record))
        break
      case 'metric.cpu':
        metricPoints.push(...cpuMetricPoints(record))
        break
      case 'metric.network_usage':
        metricPoints.push(...networkUsageMetricPoints(record))
        break
      case 'metric.js_thread':
        metricPoints.push(jsThreadMetricPoint(record))
        break
      case 'health.report':
        metricPoints.push(...healthMetricPoints(record))
        logs.push(healthLog(record))
        break
      case 'breadcrumb':
        logs.push(breadcrumbLog(record))
        break
    }
  }

  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    otelSemconvVersion: RECORD_SEMCONV_VERSION,
    resource: {
      attributes: attributesToOtel({
        'service.name': options.serviceName ?? 'hakka-app',
        ...(options.serviceVersion ? { 'service.version': options.serviceVersion } : {}),
        'telemetry.sdk.name': 'hakka',
        'hakka.schema.version': String(RECORD_SCHEMA_VERSION),
        'otel.semconv.version': RECORD_SEMCONV_VERSION,
        ...options.resourceAttributes,
      }),
    },
    scope: {
      name: options.scopeName ?? DEFAULT_SCOPE_NAME,
      version: options.scopeVersion,
    },
    spans,
    metricPoints,
    logs,
  }
}

function networkRecordToSpan(record: NetworkRecord): OtelSpan {
  const request = record.request
  const startTime = request.startTime ?? record.timestamp
  const endTime = request.duration == null ? undefined : startTime + request.duration
  const attributes = attributesToOtel({
    ...record.tags,
    ...record.attributes,
    'hakka.record.id': record.id,
    'hakka.record.kind': record.kind,
    'hakka.request.id': request.id,
  })

  return {
    // `request.correlationId` is what an OTel-instrumented next hop was handed via the
    // traceparent header (engine/traceparent.ts) — deriving the same trace-id here is what
    // lets this span join that trace instead of arriving orphaned.
    traceId: request.correlationId ? deriveTraceId(request.correlationId) : undefined,
    // `record.id` (`network-<uuid>`) is not a valid OTel span id (16 lowercase hex chars) —
    // derive one instead of reusing it verbatim, matching deriveTraceId's fallback for a
    // non-hex/non-UUID input, halved to spanId's 8-byte width.
    spanId: deriveTraceId(record.id).slice(0, 16),
    name: `${request.method} ${request.url}`,
    kind: 'client',
    startTimeUnixNano: millisToUnixNano(startTime),
    endTimeUnixNano: endTime == null ? undefined : millisToUnixNano(endTime),
    attributes,
    status: request.error ? 'error' : request.status == null ? 'unset' : request.status >= 400 ? 'error' : 'ok',
  }
}

function traceRecordToSpan(record: TraceRecord): OtelSpan {
  return {
    traceId: record.traceId,
    spanId: record.spanId,
    parentSpanId: record.parentSpanId,
    name: record.name,
    kind: 'internal',
    startTimeUnixNano: millisToUnixNano(record.startTime),
    endTimeUnixNano: record.endTime == null ? undefined : millisToUnixNano(record.endTime),
    attributes: attributesToOtel({
      ...record.tags,
      ...record.attributes,
      'hakka.record.id': record.id,
      'hakka.record.kind': record.kind,
    }),
    status: record.status,
  }
}

function frameMetricPoints(record: FrameMetricRecord): OtelMetricPoint[] {
  const attributes = attributesToOtel({
    ...record.tags,
    'hakka.record.id': record.id,
    slow: record.slow,
    frozen: record.frozen,
  })
  const points = [metricPoint('hakka.frame.duration', 'ms', record.timestamp, record.durationMs, attributes)]
  if (record.refreshRateHz != null) {
    points.push(metricPoint('hakka.frame.refresh_rate', 'Hz', record.timestamp, record.refreshRateHz, attributes))
  }
  return points
}

function memoryMetricPoints(record: MemoryMetricRecord): OtelMetricPoint[] {
  const attributes = attributesToOtel({ ...record.tags, 'hakka.record.id': record.id })
  return compact([
    record.pssBytes == null
      ? undefined
      : metricPoint('hakka.memory.pss', 'By', record.timestamp, record.pssBytes, attributes),
    record.heapUsedBytes == null
      ? undefined
      : metricPoint('hakka.memory.heap.used', 'By', record.timestamp, record.heapUsedBytes, attributes),
    record.heapMaxBytes == null
      ? undefined
      : metricPoint('hakka.memory.heap.max', 'By', record.timestamp, record.heapMaxBytes, attributes),
  ])
}

function cpuMetricPoints(record: CpuMetricRecord): OtelMetricPoint[] {
  if (record.processCpuPercent == null) return []
  return [
    metricPoint(
      'hakka.cpu.process.percent',
      '%',
      record.timestamp,
      record.processCpuPercent,
      attributesToOtel({ ...record.tags, 'hakka.record.id': record.id }),
    ),
  ]
}

function networkUsageMetricPoints(record: NetworkUsageMetricRecord): OtelMetricPoint[] {
  const attributes = attributesToOtel({ ...record.tags, 'hakka.record.id': record.id })
  return compact([
    record.rxBytes == null
      ? undefined
      : metricPoint('hakka.network.rx', 'By', record.timestamp, record.rxBytes, attributes),
    record.txBytes == null
      ? undefined
      : metricPoint('hakka.network.tx', 'By', record.timestamp, record.txBytes, attributes),
  ])
}

function jsThreadMetricPoint(record: JsThreadMetricRecord): OtelMetricPoint {
  return metricPoint(
    'hakka.js_thread.event_loop_delay',
    'ms',
    record.timestamp,
    record.eventLoopDelayMs,
    attributesToOtel({ ...record.tags, 'hakka.record.id': record.id }),
  )
}

function healthMetricPoints(record: HealthReportRecord): OtelMetricPoint[] {
  const attributes = attributesToOtel({ ...record.tags, 'hakka.record.id': record.id })
  return compact([
    metricPoint('hakka.health.requests', '1', record.timestamp, record.totalRequests, attributes),
    metricPoint('hakka.health.error_rate', '1', record.timestamp, record.errorRate, attributes),
    record.slowFrameRate == null
      ? undefined
      : metricPoint('hakka.health.slow_frame_rate', '1', record.timestamp, record.slowFrameRate, attributes),
    record.frozenFrameCount == null
      ? undefined
      : metricPoint('hakka.health.frozen_frames', '1', record.timestamp, record.frozenFrameCount, attributes),
  ])
}

function breadcrumbLog(record: BreadcrumbRecord): OtelLogRecord {
  return {
    timeUnixNano: millisToUnixNano(record.timestamp),
    severityText: 'INFO',
    body: record.name,
    attributes: attributesToOtel({
      ...record.tags,
      ...record.attributes,
      'hakka.record.id': record.id,
      'hakka.record.kind': record.kind,
    }),
  }
}

function healthLog(record: HealthReportRecord): OtelLogRecord {
  return {
    timeUnixNano: millisToUnixNano(record.timestamp),
    severityText: record.errorRate > 0 ? 'WARN' : 'INFO',
    body: record.summary ?? 'health.report',
    attributes: attributesToOtel({
      ...record.tags,
      'hakka.record.id': record.id,
      'hakka.record.kind': record.kind,
      'hakka.health.window_start': record.windowStart,
      'hakka.health.window_end': record.windowEnd,
    }),
  }
}

function metricPoint(
  name: string,
  unit: string,
  timestamp: number,
  value: number,
  attributes: readonly OtelAttribute[],
): OtelMetricPoint {
  return {
    name,
    unit,
    timeUnixNano: millisToUnixNano(timestamp),
    value,
    attributes,
  }
}

function attributesToOtel(
  attributes: Readonly<Record<string, string | number | boolean | undefined>> = {},
): OtelAttribute[] {
  const output: OtelAttribute[] = []
  for (const key of Object.keys(attributes).sort((left, right) => left.localeCompare(right))) {
    const value = attributes[key]
    if (value !== undefined) output.push({ key, value })
  }
  return output
}

function compact<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined)
}

function millisToUnixNano(milliseconds: number): string {
  const whole = Math.trunc(milliseconds)
  return `${whole}000000`
}

/**
 * `Exporter` (ADR 0009) wrapper around `recordsToOtelJson()`. AWKWARD FIT,
 * documented honestly rather than papered over: `recordsToOtelJson` operates
 * over `ContractRecord[]` — network requests, traces, metrics, breadcrumbs,
 * health reports — a strictly wider input than the `NetworkRequest[]`
 * snapshot this contract hands every exporter. This wrapper adapts by
 * lifting each request through the existing `networkRequestToRecord()`
 * helper into a `network.request`-kind record; it necessarily produces only
 * the `spans` half of a full OTel export (no metric points, no non-network
 * logs) — a caller wanting the other record kinds needs the store's spans
 * and metrics, which are not part of an `Exporter`'s snapshot input, and
 * should call `recordsToOtelJson` directly with its own `ContractRecord[]`.
 * `includesBodies: false` — verified against `networkRecordToSpan` above:
 * the OTel span model here carries method/url/status/duration/tags/
 * attributes and nothing else, no body field exists to leak through.
 */
export function createOtelJsonExporter(options?: OtelExportOptions): Exporter {
  return {
    id: 'hakka.otel-json',
    label: 'OpenTelemetry JSON',
    fileExtension: 'otel.json',
    mimeType: 'application/json',
    lossy: true,
    includesBodies: false,
    streaming: false,
    export(requests) {
      const records = requests.map((request) => networkRequestToRecord(request))
      return JSON.stringify(recordsToOtelJson(records, options), null, 2)
    },
  }
}
