import type { NetworkRequest } from './types'

export const RECORD_SCHEMA_VERSION = 1 as const
export const RECORD_SEMCONV_VERSION = '1.40.0' as const

export type RecordKind =
  | 'network.request'
  | 'metric.frame'
  | 'metric.memory'
  | 'metric.cpu'
  | 'metric.network_usage'
  | 'metric.js_thread'
  | 'breadcrumb'
  | 'trace'
  | 'health.report'

export type AttributeValue = string
export type Attributes = Readonly<Record<string, AttributeValue>>
export type Tags = Readonly<Record<string, string>>

export interface BaseRecord {
  readonly id: string
  readonly kind: RecordKind
  readonly schemaVersion: typeof RECORD_SCHEMA_VERSION
  readonly timestamp: number
  readonly sessionId?: string
  readonly tags?: Tags
}

export interface NetworkRecord extends BaseRecord {
  readonly kind: 'network.request'
  readonly otelSemconvVersion: typeof RECORD_SEMCONV_VERSION
  readonly request: NetworkRequest
  readonly attributes: Attributes
}

export interface FrameMetricRecord extends BaseRecord {
  readonly kind: 'metric.frame'
  readonly durationMs: number
  readonly refreshRateHz?: number
  readonly slow: boolean
  readonly frozen: boolean
}

export interface MemoryMetricRecord extends BaseRecord {
  readonly kind: 'metric.memory'
  readonly pssBytes?: number
  readonly heapUsedBytes?: number
  readonly heapMaxBytes?: number
}

export interface CpuMetricRecord extends BaseRecord {
  readonly kind: 'metric.cpu'
  readonly processCpuPercent?: number
}

export interface NetworkUsageMetricRecord extends BaseRecord {
  readonly kind: 'metric.network_usage'
  readonly rxBytes?: number
  readonly txBytes?: number
}

export interface JsThreadMetricRecord extends BaseRecord {
  readonly kind: 'metric.js_thread'
  readonly eventLoopDelayMs: number
}

export interface BreadcrumbRecord extends BaseRecord {
  readonly kind: 'breadcrumb'
  readonly name: string
  readonly attributes?: Attributes
}

export interface TraceRecord extends BaseRecord {
  readonly kind: 'trace'
  readonly name: string
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly startTime: number
  readonly endTime?: number
  readonly attributes?: Attributes
  readonly status?: 'ok' | 'error' | 'unset'
}

export interface HealthReportRecord extends BaseRecord {
  readonly kind: 'health.report'
  readonly windowStart: number
  readonly windowEnd: number
  readonly totalRequests: number
  readonly errorRate: number
  readonly slowFrameRate?: number
  readonly frozenFrameCount?: number
  readonly summary?: string
}

export type ContractRecord =
  | NetworkRecord
  | FrameMetricRecord
  | MemoryMetricRecord
  | CpuMetricRecord
  | NetworkUsageMetricRecord
  | JsThreadMetricRecord
  | BreadcrumbRecord
  | TraceRecord
  | HealthReportRecord

export type RecordSink = (record: ContractRecord) => void | Promise<void>

export interface SinkSubscription {
  cancel(): void
}

export interface NetworkRecordOptions {
  readonly id?: string
  readonly sessionId?: string
  readonly tags?: Tags
  readonly timestamp?: number
}

export function networkRequestToRecord(request: NetworkRequest, options: NetworkRecordOptions = {}): NetworkRecord {
  const status = request.status ?? undefined
  const attributes: Record<string, AttributeValue> = {
    'http.request.method': request.method,
    'url.full': request.url,
    'hakka.source': request.source ?? 'native',
  }

  if (status !== undefined) attributes['http.response.status_code'] = String(status)
  if (request.error) attributes['error.type'] = request.error
  if (request.networkProtocol) attributes['network.protocol.name'] = request.networkProtocol
  if (request.duration != null) attributes['hakka.duration_ms'] = String(request.duration)
  if (request.graphql?.operationName) attributes['graphql.operation.name'] = request.graphql.operationName

  return {
    id: options.id ?? createRecordId('network'),
    kind: 'network.request',
    schemaVersion: RECORD_SCHEMA_VERSION,
    timestamp: options.timestamp ?? request.timestamp ?? request.startTime,
    sessionId: options.sessionId,
    tags: options.tags,
    otelSemconvVersion: RECORD_SEMCONV_VERSION,
    request,
    attributes,
  }
}

function createRecordId(prefix: string): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  const randomUUID = crypto?.randomUUID
  if (typeof randomUUID === 'function') {
    return `${prefix}-${randomUUID.call(crypto)}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
