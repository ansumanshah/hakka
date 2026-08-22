/**
 * hakka-core — platform-neutral network-capture engine.
 */
export const HAKKA_CORE_VERSION = '0.1.0'

export type {
  NetworkRequest,
  HakkaConfig,
  HttpMethod,
  RequestType,
  RequestRuntime,
  RequestListener,
  ReadonlyRecord,
  NetworkTiming,
  WsMessage,
  GraphQLInfo,
  ShakeConfig,
  BubbleConfig,
  InspectorVisibility,
  ConnectionStatus,
  FrameworkSpan,
  RequestKind,
} from './model/types'
export { RequestStatus, getRequestStatus, DEFAULT_CONFIG } from './model/types'

// capture-source contract (@experimental — ADR 0006; exported from the root
// entry so consumers never need a paths alias or subpath, either of which
// resurrects the TS7/tsdown src-scatter failure mode)
export type {
  CaptureSource,
  CaptureSourceContext,
  CaptureSourceIdentity,
  CaptureCorrelation,
} from './contract/captureSource'
export { createCycleGuard } from './contract/cycleGuard'
export type { CycleGuard } from './contract/cycleGuard'
export { checkCaptureSourceConformance } from './contract/conformance'
export type { CaptureSourceProbe, ConformanceCheck, ConformanceReport } from './contract/conformance'

// ADR 0009's other two contract axes. Same shape as CaptureSource: the contract
// plus a harness a third-party implementation runs against itself.
export type { Exporter, ExporterIdentity } from './contract/exporter'
export { checkExporterConformance } from './contract/exporterConformance'
export type { ExporterProbe } from './contract/exporterConformance'
export type {
  RuleEngine,
  RuleEngineDecision,
  RuleEngineIdentity,
  RuleEnginePhase,
  RuleEngineRequest,
  RuleEngineResponse,
  RuleEngineRuleDescriptor,
  RuleEngineSubstituteResponse,
} from './contract/ruleEngine'
export { checkRuleEngineConformance } from './contract/ruleEngineConformance'
export type {
  RuleEngineConformanceCheck,
  RuleEngineConformanceReport,
  RuleEngineProbe,
} from './contract/ruleEngineConformance'

// Exporter wrappers around the writers exported below — construct one when you
// want identity (label, extension, MIME) alongside the bytes, e.g. to build a
// share sheet from a registry instead of a hardcoded list.
export { createHarExporter } from './model/har'
export { createOtelJsonExporter } from './model/otel'
export { createPostmanExporter } from './model/postman'
export { createCurlExporter } from './utils/share'
export { createSessionExporter } from './session/serialize'
export { createAgentContextExporter } from './export/agentContext'
export { createAgentEvidenceExporter } from './export/agentEvidence'
export { createEvidenceBundleExporter } from './repro/buildEvidenceBundle'
export { createReproBundleExporter } from './repro/serializeReproBundle'
export { createPlaywrightRoutesExporter } from './interop/playwright'
export { createMswHandlersExporter } from './interop/msw'

// RuleEngine wrappers. The interceptors keep calling the concrete engines
// directly — these exist for registration and introspection, off the hot path.
export { createMockRuleEngine } from './engine/MockEngine'
export { createThrottleRuleEngine } from './engine/ThrottleEngine'
export { createBreakpointRuleEngine } from './engine/BreakpointEngine'

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
// otlp — live push of traces + metrics + logs to any OpenTelemetry collector
export { pushOtlp, toOtlpTraces, toOtlpMetrics, toOtlpLogs } from './model/otlp'
export type {
  OtlpPushOptions,
  OtlpPushResult,
  OtlpSignalResult,
  OtlpTracesPayload,
  OtlpMetricsPayload,
  OtlpLogsPayload,
} from './model/otlp'

export { buildHar, exportHarString, requestToHarEntry } from './model/har'
export type { HarExport } from './model/har'

export { buildPostmanCollection, exportPostmanString, requestToPostmanItem } from './model/postman'
export type { PostmanCollection, PostmanItem, PostmanRequest, PostmanExportOptions } from './model/postman'

export { Hakka } from './engine/HakkaFacade'
export type { NativeCaptureAdapter, NativeHakkaModule, NativeEventEmitterLike } from './engine/HakkaFacade'
export { NATIVE_MODULE_NAMES } from './engine/nativeProtocol'
export type {
  HakkaPlugin,
  HakkaPanel,
  HakkaPluginContext,
  HakkaBodyRenderer,
  HakkaContextMenuItem,
} from './engine/plugins'
export { breakpointEngine } from './engine/BreakpointEngine'
export type {
  Breakpoint,
  BreakpointInput,
  BreakpointPhase,
  PausedEntry,
  PausedRequest,
  PausedResponse,
  ResumeAction,
  ResumeResponseAction,
} from './engine/BreakpointEngine'
export { mockEngine, MOCK_FAILURE_CODES, MOCK_FAILURE_MESSAGES } from './engine/MockEngine'
export type {
  MockRule,
  MockRuleInput,
  MockRuleModify,
  MockResponse,
  MockRequestContext,
  MockResponseContext,
  MockFailure,
  MockFailureCode,
  NativeMockBridge,
  NativeMockRulePayload,
} from './engine/MockEngine'
export type { BodyDecoder, SseEvent, ProtoField, GrpcWebFrame } from './engine/decoders'
export { bodyDecoders, decodeSse, decodeProtobuf, decodeGrpcWeb } from './engine/decoders'
export type { WsFrameDecoder, WsFrameInfo } from './engine/wsDecoders'
export { wsFrameDecoders, decodeWsFrame } from './engine/wsDecoders'
export { ThrottleEngine } from './engine/ThrottleEngine'
export type { ThrottleProfile, ThrottleConfig } from './engine/ThrottleEngine'
export { applyControlCommand, isDeviceToHostCommand, parseControlCommand } from './engine/control'
export type {
  BreakpointPausedRequest,
  BreakpointPausedResponse,
  BreakpointRequestEdits,
  BreakpointResponseEdits,
  ControlCommand,
} from './engine/control'
export { generateMockRules } from './engine/mockFromTraffic'
export type { GenerateMockRulesOptions } from './engine/mockFromTraffic'
export { buildReplayInit, replayRequest, REPLAY_MARKER_HEADER } from './engine/replayRequest'
export type { ReplayInit } from './engine/replayRequest'
// analyze — one-call diagnosis over captured requests (backs the MCP `diagnose` tool)
export { analyzeRequests } from './analyze/analyzeRequests'
export type {
  AnalyzeOptions,
  DiagnosisFinding,
  DiagnosisKind,
  DiagnosisSeverity,
  RequestDiagnosis,
  SlowRequest,
} from './analyze/analyzeRequests'
// leak detection — the offensive half of redaction: does this app send a credential
// or PII somewhere it should not (backs the MCP `detect_leaks` tool)
export { detectLeaks } from './analyze/leakDetection'
export type {
  EndpointFieldBaseline,
  FieldBaseline,
  LeakConfidence,
  LeakDetectionOptions,
  LeakDetectionResult,
  LeakEvidence,
  LeakFinding,
  LeakKind,
} from './analyze/leakDetection'
export {
  HAKKA_TRACE_HEADER,
  configureTrace,
  currentTraceId,
  newTraceId,
  resolveOutgoingTrace,
  setTraceProvider,
  shouldPropagateTrace,
} from './engine/trace'
export type { TraceConfig, TraceProvider } from './engine/trace'
export { TRACEPARENT_HEADER, buildTraceparent, deriveTraceId } from './engine/traceparent'

export { ConsoleInterceptor } from './capture/console'
export { setStackCapture, isStackCaptureEnabled } from './capture/stackTrace'
export { enableFetchInterceptor } from './capture/fetch'
export { enableXHRInterceptor } from './capture/xhr'
export { enableWebSocketInterceptor } from './capture/websocket'

// The `CaptureSource` wrappers around the interceptors above (ADR 0006). The
// `enable*` functions stay exported and stay the path every first-party
// caller uses; these exist so a source can be registered, started, and torn
// down through one contract without knowing which mechanism it wraps.
export { createFetchCaptureSource } from './capture/fetch'
export type { FetchCaptureSourceOptions } from './capture/fetch'
export { createXHRCaptureSource } from './capture/xhr'
export type { XHRCaptureSourceOptions } from './capture/xhr'
export { createWebSocketCaptureSource } from './capture/websocket'
export { createConsoleCaptureSource } from './capture/console'

export { RingBuffer } from './storage/RingBuffer'
export { RetentionPolicy } from './storage/RetentionPolicy'
export type { StorageAdapter } from './storage/StorageAdapter'

export { LogStore, logStore } from './log/LogStore'
export { log, logDebug, logInfo, logWarn, logError } from './log/logApi'
export type { LogOptions } from './log/logApi'
export type { LogEntry, LogLevel, LogListener } from './log/types'

export { extractHost, getUniqueDomains, calculateDomainStats } from './utils/domainUtils'
export type { DomainStats } from './utils/domainUtils'
export { parseUrl, splitPathAndQuery } from './utils/urlParser'
export { getImageFormat, getImageSource, isImageResponse, parseContentType } from './utils/contentType'
export type { ParsedContentType } from './utils/contentType'
export { buildCurl } from './utils/share'
export { formatBytes, formatDuration, formatTimestamp, truncateText } from './utils/formatting'
export { extractGraphQLOperationName, extractGraphQLQuery, getRequestDisplayName } from './utils/graphql'
export {
  DEFAULT_SENSITIVE_HEADERS,
  isSensitiveHeader,
  redactHeaders,
  redactHeaderValues,
  stripHeaders,
} from './utils/headerRedaction'
export { configureBodyRedaction, getBodyRedactionFields, redactJsonBody } from './utils/bodyRedaction'
export {
  DEFAULT_SHARE_SCRUB_HEADERS,
  DEFAULT_SHARE_SCRUB_JSON_FIELDS,
  DEFAULT_SHARE_SCRUB_QUERY_PARAMS,
  describeShareScrub,
  scrubBodyForShare,
  scrubHeadersForShare,
  scrubHeaderValuesForShare,
  scrubNetworkRequestForShare,
  scrubRequestsForShare,
  scrubUrlForShare,
} from './utils/shareScrub'
export type { ShareScrubCategory, ShareScrubOptions, ShareScrubRemoval, ShareScrubSummary } from './utils/shareScrub'
export { hostMatchesList, matchesIgnoredPattern, shouldCaptureUrl } from './utils/hostFilter'
export type { HostFilterConfig } from './utils/hostFilter'
export { DEFAULT_MAX_BODY_SIZE, estimateBodySize, isBodyTruncated, limitBodySize } from './utils/bodySizeLimit'
export { parseRequestCookies, parseSetCookie } from './utils/cookies'
export type { ParsedCookie } from './utils/cookies'
export { decodeUrl, encodeUrl, isUrlEncoded } from './utils/urlCodec'

// query engine (search / sort / group) — platform-neutral, shared with native layers
export {
  compileQuery,
  createGroupCache,
  groupRequests,
  parseRangeFilters,
  parseSearchTokens,
  parseStatusDsl,
  sortRequests,
} from './query'
export type {
  AdvancedQuery,
  GroupBy,
  RangeFilters,
  RequestGroup,
  SearchMode,
  SearchScope,
  SearchToken,
  SortField,
  SortOrder,
} from './query'

// trace tree / badge summary — cross-runtime Next.js request insights
export { assembleTraceTree } from './query/traceTree'
export type { TraceBar, TraceTree, AssembleTraceTreeOptions } from './query/traceTree'
export { summarizeTraceGroup } from './query/traceSummary'
export type { TraceBadgeSummary } from './query/traceSummary'

// codegen — "copy as code" snippet generators (sibling of utils/share.ts buildCurl)
export { buildAxios, buildFetch, buildHttpie, buildMswHandlers, buildPython, toPlaywrightRoutes } from './codegen'
export type { BuildMswHandlersOptions, ToPlaywrightRoutesOptions } from './codegen'

// interop — MSW (Mock Service Worker) v2 handlers → MockRule round-trip (import direction;
// buildMswHandlers above is the export direction, registered as a codegen target)
export { parseMswHandlers } from './interop/msw'
export type { ParseMswHandlersResult, UnsupportedMswHandler } from './interop/msw'

// session — versioned '.hakka' session file serialize/deserialize
export { serializeSession, deserializeSession, SESSION_SCHEMA_VERSION } from './session/serialize'
export type { HakkaSessionFile, DeserializedSession, SessionMeta } from './session/serialize'

// export — compact agent-context pack (paste-into-an-AI-coding-agent view)
export { toAgentContext } from './export/agentContext'
export type { AgentContextOptions } from './export/agentContext'
export { formatEvidenceBundleForAgent } from './export/agentEvidence'
export type { FormatEvidenceBundleForAgentOptions } from './export/agentEvidence'

// repro — self-contained "reproduce bundle" (requests + derived mock rules),
// versioned '.hakka-repro' JSON serialize/deserialize
export { buildReproBundle, REPRO_BUNDLE_SCHEMA_VERSION } from './repro/buildReproBundle'
export type { ReproBundle, ReproBundleMeta, ReproMockRule, BuildReproBundleOptions } from './repro/buildReproBundle'
export { serializeReproBundle, deserializeReproBundle } from './repro/serializeReproBundle'
export type { HakkaReproBundleFile, DeserializedReproBundle } from './repro/serializeReproBundle'

// evidence bundle — size-budgeted requests+mocks+trace+diagnosis+console pack
// (backs `export_evidence`/`get_trace` MCP tools and the browser's "Copy as
// agent context" action)
export { buildEvidenceBundle, EVIDENCE_BUNDLE_SCHEMA_VERSION } from './repro/buildEvidenceBundle'
export type {
  EvidenceBundle,
  EvidenceBundleOptions,
  EvidenceBundleTruncation,
  EvidenceBundleTruncationKind,
} from './repro/buildEvidenceBundle'

// search — natural language → search DSL heuristic mapper
export { nlToQuery } from './search/nlToQuery'
