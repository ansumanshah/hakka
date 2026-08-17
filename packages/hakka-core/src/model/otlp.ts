/**
 * OTLP/HTTP JSON exporter — pushes captured traffic, performance metrics, and
 * logs to any OpenTelemetry collector. `recordsToOtelJson` already shapes
 * records into OTel spans/metric points/log records (semconv-pinned); this
 * module transforms that into the OTLP/HTTP wire format (resourceSpans /
 * resourceMetrics / resourceLogs, KeyValue attribute encoding) and POSTs each
 * non-empty signal to the collector's `/v1/traces`, `/v1/metrics`, `/v1/logs`.
 * A *live* push exporter, complementing the file-saved JSON export.
 */
import type { ContractRecord } from './contract'
import { recordsToOtelJson, type OtelAttribute, type OtelExportOptions, type OtelJsonExport } from './otel'

// OTLP/HTTP JSON wire shapes — minimal, only the fields emitted here.
interface OtlpAnyValue {
  stringValue?: string
  boolValue?: boolean
  intValue?: string // int64 is a string in OTLP/JSON
  doubleValue?: number
}
interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}
interface OtlpScope {
  name: string
  version?: string
}
interface OtlpResource {
  attributes: OtlpKeyValue[]
}

export interface OtlpTracesPayload {
  resourceSpans: {
    resource: OtlpResource
    scopeSpans: { scope: OtlpScope; spans: unknown[] }[]
  }[]
}
export interface OtlpMetricsPayload {
  resourceMetrics: {
    resource: OtlpResource
    scopeMetrics: { scope: OtlpScope; metrics: unknown[] }[]
  }[]
}
export interface OtlpLogsPayload {
  resourceLogs: {
    resource: OtlpResource
    scopeLogs: { scope: OtlpScope; logRecords: unknown[] }[]
  }[]
}

// OTLP SpanKind enum. INTERNAL = 1, CLIENT = 3.
const SPAN_KIND = { internal: 1, client: 3 } as const
// OTLP StatusCode enum. UNSET = 0, OK = 1, ERROR = 2.
const STATUS_CODE = { unset: 0, ok: 1, error: 2 } as const
// OTLP SeverityNumber mapping (INFO=9, WARN=13, ERROR=17).
const SEVERITY_NUMBER = { INFO: 9, WARN: 13, ERROR: 17 } as const

function toAnyValue(v: string | number | boolean): OtlpAnyValue {
  if (typeof v === 'boolean') return { boolValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }
  return { stringValue: v }
}

function toKeyValues(attributes: readonly OtelAttribute[]): OtlpKeyValue[] {
  return attributes.map((a) => ({ key: a.key, value: toAnyValue(a.value) }))
}

function scopeOf(exp: OtelJsonExport): OtlpScope {
  return { name: exp.scope.name, ...(exp.scope.version ? { version: exp.scope.version } : {}) }
}

/** Transform a Hakka OTel export into an OTLP/HTTP `/v1/traces` payload. */
export function toOtlpTraces(exp: OtelJsonExport): OtlpTracesPayload {
  return {
    resourceSpans: [
      {
        resource: { attributes: toKeyValues(exp.resource.attributes) },
        scopeSpans: [
          {
            scope: scopeOf(exp),
            spans: exp.spans.map((s) => ({
              ...(s.traceId ? { traceId: s.traceId } : {}),
              spanId: s.spanId,
              ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
              name: s.name,
              kind: SPAN_KIND[s.kind],
              startTimeUnixNano: s.startTimeUnixNano,
              ...(s.endTimeUnixNano ? { endTimeUnixNano: s.endTimeUnixNano } : {}),
              attributes: toKeyValues(s.attributes),
              status: { code: STATUS_CODE[s.status ?? 'unset'] },
            })),
          },
        ],
      },
    ],
  }
}

/** Transform into an OTLP/HTTP `/v1/metrics` payload (points grouped by name as gauges). */
export function toOtlpMetrics(exp: OtelJsonExport): OtlpMetricsPayload {
  const byName = new Map<string, { unit: string; dataPoints: unknown[] }>()
  for (const p of exp.metricPoints) {
    const group = byName.get(p.name) ?? { unit: p.unit, dataPoints: [] }
    group.dataPoints.push({
      timeUnixNano: p.timeUnixNano,
      asDouble: p.value,
      attributes: toKeyValues(p.attributes),
    })
    byName.set(p.name, group)
  }
  const metrics = [...byName.entries()].map(([name, group]) => ({
    name,
    unit: group.unit,
    gauge: { dataPoints: group.dataPoints },
  }))
  return {
    resourceMetrics: [
      {
        resource: { attributes: toKeyValues(exp.resource.attributes) },
        scopeMetrics: [{ scope: scopeOf(exp), metrics }],
      },
    ],
  }
}

/** Transform into an OTLP/HTTP `/v1/logs` payload. */
export function toOtlpLogs(exp: OtelJsonExport): OtlpLogsPayload {
  return {
    resourceLogs: [
      {
        resource: { attributes: toKeyValues(exp.resource.attributes) },
        scopeLogs: [
          {
            scope: scopeOf(exp),
            logRecords: exp.logs.map((l) => ({
              timeUnixNano: l.timeUnixNano,
              severityNumber: SEVERITY_NUMBER[l.severityText],
              severityText: l.severityText,
              body: { stringValue: l.body },
              attributes: toKeyValues(l.attributes),
            })),
          },
        ],
      },
    ],
  }
}

export interface OtlpPushOptions extends OtelExportOptions {
  /** Collector base URL, e.g. `http://localhost:4318`. `/v1/{traces,metrics,logs}` are appended. */
  endpoint: string
  /** Extra headers (auth tokens, tenant ids, …) sent on every signal request. */
  headers?: Record<string, string>
  /** Override `fetch` (tests / non-standard runtimes). Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch
}

export interface OtlpSignalResult {
  ok: boolean
  status?: number
  error?: string
}

export interface OtlpPushResult {
  traces?: OtlpSignalResult
  metrics?: OtlpSignalResult
  logs?: OtlpSignalResult
}

/**
 * Push records to an OTLP/HTTP collector as traces + metrics + logs. Only signals
 * that have data are sent. Per-signal failures are captured in the result rather
 * than thrown, so a collector being down never breaks the caller. The requests
 * carry the `_noHakka` opt-out so Hakka's own fetch interceptor doesn't re-capture
 * them (avoids a capture loop on web / RN-JS mode).
 */
export async function pushOtlp(records: readonly ContractRecord[], options: OtlpPushOptions): Promise<OtlpPushResult> {
  const { endpoint, headers, fetchImpl, ...exportOptions } = options
  const doFetch = fetchImpl ?? globalThis.fetch
  const exp = recordsToOtelJson(records, exportOptions)
  const base = endpoint.replace(/\/+$/, '')
  const result: OtlpPushResult = {}

  const post = async (path: string, payload: unknown): Promise<OtlpSignalResult> => {
    try {
      const init = {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(payload),
        // Skip Hakka's own fetch interceptor — this telemetry push must not be captured.
        _noHakka: true,
      } as RequestInit
      const res = await doFetch(`${base}${path}`, init)
      return { ok: res.ok, status: res.status }
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  if (exp.spans.length > 0) result.traces = await post('/v1/traces', toOtlpTraces(exp))
  if (exp.metricPoints.length > 0) result.metrics = await post('/v1/metrics', toOtlpMetrics(exp))
  if (exp.logs.length > 0) result.logs = await post('/v1/logs', toOtlpLogs(exp))

  return result
}
