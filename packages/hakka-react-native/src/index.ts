/**
 * hakka-react-native — Public API (core only)
 *
 * UI components are in 'hakka-react-native/ui' — import separately to avoid bundling
 * when using native UI only.
 *
 * Monitors are in 'hakka-react-native/monitors' — import separately to avoid bundling
 * when not using storage/query monitoring.
 */

import './bootstrap'
import { Hakka } from 'hakka-core'

export { Hakka }

// Core bridge — the singleton is the API; the class is exported type-only so
// `new HakkaBridge()` never becomes accidental public surface to semver-lock.
export { hakkaBridge, getDesktopSocket, configureMMKVInstance } from './core/HakkaBridge'
export type { HakkaBridge, MMKVInstanceLike } from './core/HakkaBridge'
export type { ConnectionStatus } from 'hakka-core'

export { useNetworkLogs } from './hooks/useNetworkLogs'
export { useHakka } from './hooks/useHakka'
export { useShakeToShare } from './hooks/useShakeToShare'

export type { NetworkRequest, HakkaConfig, HttpMethod, RequestType, RequestListener, ReadonlyRecord } from 'hakka-core'

export { RequestStatus, getRequestStatus } from 'hakka-core'

export { RECORD_SEMCONV_VERSION, RECORD_SCHEMA_VERSION, networkRequestToRecord } from 'hakka-core'
export { recordsToOtelJson } from 'hakka-core'

// Privacy: redact named fields inside captured JSON bodies (case-insensitive), applied
// before bodies reach the store. Headers are redacted separately via HakkaConfig.redactHeaders.
export { configureBodyRedaction, getBodyRedactionFields } from 'hakka-core'
// URL codec backing the inspector's Decoded/Raw query-param toggle (also useful standalone).
export { decodeUrl, encodeUrl, isUrlEncoded } from 'hakka-core'
// Structured logging — write app logs that appear in the inspector's Logs tab.
export { log, logDebug, logInfo, logWarn, logError, logStore, LogStore } from 'hakka-core'
export type { LogEntry, LogLevel, LogListener, LogOptions } from 'hakka-core'

// TanStack Query integration — forwards query/mutation cache lifecycle events
// to the Logs tab. Structurally typed: no hard/peer dependency on
// @tanstack/react-query.
export { installTanstackQuery } from './integrations/tanstackQuery'
export type {
  QueryClientLike,
  InstallTanstackQueryOptions,
  TanstackQueryLifecycleState,
} from './integrations/tanstackQuery'
// OTLP — push captured traces + metrics + logs to any OpenTelemetry collector.
export { pushOtlp, toOtlpTraces, toOtlpMetrics, toOtlpLogs } from 'hakka-core'
export type { OtlpPushOptions, OtlpPushResult } from 'hakka-core'

export type {
  BreadcrumbRecord,
  CpuMetricRecord,
  FrameMetricRecord,
  ContractRecord,
  AttributeValue,
  Attributes,
  BaseRecord,
  RecordKind,
  Tags,
  HealthReportRecord,
  JsThreadMetricRecord,
  MemoryMetricRecord,
  NetworkRecord,
  NetworkUsageMetricRecord,
  RecordSink,
  TraceRecord,
  SinkSubscription,
} from 'hakka-core'
export type {
  OtelAttribute,
  OtelExportOptions,
  OtelJsonExport,
  OtelLogRecord,
  OtelMetricPoint,
  OtelResource,
  OtelScope,
  OtelSpan,
} from 'hakka-core'

export { ThrottleEngine } from 'hakka-core'
export type { ThrottleProfile, ThrottleConfig } from 'hakka-core'

/**
 * Switch capture to native-only mode and restart an active session.
 * Equivalent to `Hakka.start({ mode: 'native' })`.
 */
export function enableNativeCapture(): void {
  Hakka.enableNativeCapture()
}

/**
 * Switch capture to JS-only mode and restart an active session.
 * Equivalent to `Hakka.start({ mode: 'js' })`.
 */
export function enableJsCapture(): void {
  Hakka.enableJsCapture()
}

/**
 * Backward-compatible alias for `enableNativeCapture()`.
 */
export function enableNativeLayerCapture(): void {
  Hakka.enableNativeCapture()
}

/**
 * Backward-compatible alias for `enableJsCapture()`.
 */
export function enableJsLayerCapture(): void {
  Hakka.enableJsCapture()
}

export { mockEngine } from 'hakka-core'
export type { MockRule, MockRuleInput, MockResponse } from 'hakka-core'
