/**
 * Runtime APIs used by the React Native SDK. Analysis and decoder modules stay
 * outside Metro's initial dependency graph.
 */

export type {
  NetworkRequest,
  HakkaConfig,
  HttpMethod,
  RequestType,
  RequestListener,
  ReadonlyRecord,
  ConnectionStatus,
  StorageSnapshot,
} from './model/types'
export { RequestStatus, getRequestStatus } from './model/types'

export { RECORD_SEMCONV_VERSION, RECORD_SCHEMA_VERSION, networkRequestToRecord } from './model/contract'
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
} from './model/contract'

export { recordsToOtelJson } from './model/otel'
export type {
  OtelAttribute,
  OtelExportOptions,
  OtelJsonExport,
  OtelLogRecord,
  OtelMetricPoint,
  OtelResource,
  OtelScope,
  OtelSpan,
} from './model/otel'
export { pushOtlp, toOtlpTraces, toOtlpMetrics, toOtlpLogs } from './model/otlp'
export type { OtlpPushOptions, OtlpPushResult } from './model/otlp'

export { buildHar, exportHarString, requestToHarEntry } from './model/har'
export type { HarExport } from './model/har'
export { Hakka } from './engine/HakkaFacade'
export type { NativeCaptureAdapter, NativeHakkaModule, NativeEventEmitterLike } from './engine/HakkaFacade'
export { NATIVE_MODULE_NAMES } from './engine/nativeProtocol'
export { mockEngine } from './engine/MockEngine'
export type {
  MockRule,
  MockRuleInput,
  MockResponse,
  NativeMockBridge,
  NativeMockRulePayload,
} from './engine/MockEngine'
export { ThrottleEngine } from './engine/ThrottleEngine'
export type { ThrottleProfile, ThrottleConfig } from './engine/ThrottleEngine'
export { applyControlCommand, parseControlCommand } from './engine/control'
export { ConsoleInterceptor } from './capture/console'
export { RuntimeControlReceiver } from './contract/RuntimeControlReceiver'
export { RUNTIME_CONTROL_CAPABILITIES } from './contract/runtimeControl'

export { LogStore, logStore } from './log/LogStore'
export { log, logDebug, logInfo, logWarn, logError } from './log/logApi'
export type { LogEntry, LogLevel, LogListener } from './log/types'
export type { LogOptions } from './log/logApi'

export { configureBodyRedaction, getBodyRedactionFields, redactJsonBody } from './utils/bodyRedaction'
export { decodeUrl, encodeUrl, isUrlEncoded } from './utils/urlCodec'
export { DEFAULT_MAX_BODY_SIZE, estimateBodySize, isBodyTruncated, limitBodySize } from './utils/bodySizeLimit'
export { getImageSource, isImageResponse, parseContentType } from './utils/contentType'
export { calculateDomainStats, extractHost, getUniqueDomains } from './utils/domainUtils'
export type { DomainStats } from './utils/domainUtils'
export { formatBytes, formatDuration, formatTimestamp, truncateText } from './utils/formatting'
export { extractGraphQLOperationName, extractGraphQLQuery, getRequestDisplayName } from './utils/graphql'
export { DEFAULT_SENSITIVE_HEADERS, isSensitiveHeader, redactHeaders, stripHeaders } from './utils/headerRedaction'
export { hostMatchesList, matchesIgnoredPattern, shouldCaptureUrl } from './utils/hostFilter'
export type { HostFilterConfig } from './utils/hostFilter'
export { buildCurl } from './utils/share'
export { parseUrl, splitPathAndQuery } from './utils/urlParser'
