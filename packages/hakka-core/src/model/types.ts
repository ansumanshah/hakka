/**
 * Core types for Hakka network monitoring.
 * Unified type system — used by interceptors, UI, and native bridge.
 */

import type { Attributes } from './contract'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type ReadonlyRecord<K extends string, V> = Readonly<Record<K, V>>
export type RequestType = 'fetch' | 'xhr' | 'websocket' | 'native' | 'http'

/**
 * Which runtime captured the request. Browser captures are `'client'`; the
 * Next.js (Node) server runtime is `'server'`; the Edge runtime is `'edge'`.
 * Lets one UI show full-stack traffic from a single store.
 */
export type RequestRuntime = 'client' | 'server' | 'edge'

export interface NetworkTiming {
  /** DNS lookup duration in milliseconds */
  dnsMs?: number
  /** TLS handshake duration in milliseconds */
  tlsMs?: number
  /** TCP connection duration in milliseconds */
  connectMs?: number
  /** Time to first byte in milliseconds */
  ttfbMs?: number
  /** Content download duration in milliseconds */
  downloadMs?: number
  /** Time spent waiting in request queue */
  queueing?: number
  /** Time blocked before request */
  blocked?: number
  /** Time sending request data */
  send?: number
  /** Time waiting for response */
  wait?: number
  /** Time receiving response data */
  receive?: number
  /** SSL/TLS negotiation time */
  ssl?: number
  /** Proxy negotiation time */
  proxy?: number
  /** Total request duration */
  total?: number
}

/** A single WebSocket frame (sent or received). */
export interface WsMessage {
  timestamp: number
  direction: 'sent' | 'received'
  /**
   * Frame payload. Text frames: the string. Binary frames: base64 of the bytes
   * when within the capture cap, otherwise the byte count.
   */
  data: string | number
  size: number
  /** True when this is a binary frame (`data` is base64, or a byte count if over the cap). */
  binary?: boolean
}

/** GraphQL metadata attached to POST requests with a GraphQL body */
export interface GraphQLInfo {
  operationName?: string
  operationType: 'query' | 'mutation' | 'subscription'
  variables?: Record<string, unknown>
}

export interface NetworkRequest {
  id: string
  url: string
  method: string
  status?: number | null
  startTime: number
  endTime?: number
  duration?: number | null
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  /**
   * Additive, backward-compatible widening of `responseHeaders` for header
   * names that arrived with more than one value on the wire — chiefly
   * `Set-Cookie`, where RFC 6265 §3 forbids folding multiple values into one
   * comma-joined field (a cookie's own `Expires` attribute can legally
   * contain a comma, so a naive join is ambiguous/corrupt). `responseHeaders`
   * still carries one representative (comma-joined) value per name, so old
   * consumers keep working unchanged; when a name also appears here,
   * `responseHeaderValues[name]` is the full ordered list of real values.
   * Only header names with 2+ values need an entry here. Mirrors
   * `MockResponse.headerValues`'s shape and rationale (`engine/MockEngine.ts`)
   * on the capture side. Populated by capture sources that can see real
   * multi-value headers — currently `hakka-node`'s `http`/`https` interceptor
   * (Node's `IncomingMessage.headers` hands `set-cookie` back as a real
   * `string[]`); other capture sources may leave it unset.
   */
  responseHeaderValues?: Record<string, string[]>
  requestBody?: string | null
  responseBody?: string | null
  requestBodySize?: number
  responseBodySize?: number
  error?: string | null
  source?: RequestType
  /** Which runtime captured this request — client (browser), server (Node), or edge. */
  runtime?: RequestRuntime
  /** Shared id linking the hops of one logical request (client + server). Set when trace propagation is enabled (see `engine/trace`). */
  correlationId?: string
  /** The call-site stack ("Initiator") — populated only when stack capture is enabled (`setStackCapture(true)`). */
  initiator?: string
  timestamp?: number
  size?: number
  contentType?: string
  encoding?: string
  networkProtocol?: string
  library?: string
  redirectCount?: number
  redirectChain?: string[]
  redirectUrls?: readonly string[]
  timing?: NetworkTiming
  /** WebSocket frames (populated for source === 'websocket'). */
  messages?: WsMessage[]
  /** Negotiated WebSocket sub-protocol, e.g. 'mqtt'. Empty string until the connection opens. */
  wsProtocol?: string
  /** Whether this request was intercepted by MockEngine (not a real network request). */
  mocked?: boolean
  /** Whether this request was passed through but transformed by a MockEngine `rewrite` rule. */
  rewritten?: boolean
  /** GraphQL metadata if this is a GraphQL operation. */
  graphql?: GraphQLInfo
  /** Number of times this request was retried (same URL+method within 5s of a failed request). */
  retryCount?: number
  /** DNS lookup duration in milliseconds (flat, from core interceptors). */
  dnsMs?: number | null
  /** TLS handshake duration in milliseconds. */
  tlsMs?: number | null
  /** TCP connect duration in milliseconds. */
  connectMs?: number | null
  /** Time to first byte in milliseconds. */
  ttfbMs?: number | null
  /** Response body download duration in milliseconds. */
  downloadMs?: number | null
  /**
   * True when the response body exceeded `maxBodySize` and capture stopped
   * reading early — `responseBodySize` is then a best-known value (the
   * Content-Length header when present, else bytes decoded before bailing),
   * not an exact decoded length.
   */
  responseBodyTruncated?: boolean
  /**
   * Framework data-cache verdict for this response (e.g. `'HIT'`, `'MISS'`,
   * `'STALE'`). Not set by core interceptors themselves — populated by
   * framework adapters (e.g. `hakka-node`) that read a cache-status response
   * header (Next.js `x-nextjs-cache`, Vercel `x-vercel-cache`) after capture.
   */
  cacheStatus?: string
  /**
   * `true` while an SSE/streaming response is still emitting incremental
   * body updates (see `capture/sseCapture`); flips to `false` on the terminal
   * emit. Lets UIs mark a live stream instead of showing a frozen record.
   */
  streaming?: boolean
}

/**
 * How an inbound Next.js request originated. Lives on `FrameworkSpan`, not
 * `NetworkRequest` — the fetch/http interceptors only ever see outbound calls.
 */
export type RequestKind = 'document' | 'rsc' | 'route-handler' | 'server-action'

/**
 * A Next.js/OTel framework span — additive record kind, never mixed into
 * `NetworkRequest[]`. Joined to a `NetworkRequest` trace group only by
 * `traceId === correlationId` equality. Span `name`/`attrs` are Next-internal
 * and semi-stable — never parsed for control flow beyond a fixed allowlist in
 * hakka-node; everything else keys off `traceId`/`parentId`.
 */
export interface FrameworkSpan {
  id: string
  traceId: string
  parentId: string | null
  name: string
  startTime: number
  endTime: number
  attrs?: Attributes
  verbosity: 'primary' | 'verbose'
  runtime: RequestRuntime
  requestKind?: RequestKind
}

/**
 * A named device-storage snapshot (UserDefaults/localStorage, redacted
 * keychain, cookies, ...) streamed over the bridge — additive record kind,
 * never mixed into `NetworkRequest[]`. `store` is free-form so each runtime
 * can name its own stores (e.g. `'defaults'`, `'keychain-redacted'`,
 * `'cookies'`); the desktop UI groups by it. Snapshot-replace semantics: a
 * new frame for the same `store` replaces its prior contents wholesale, it
 * is never a diff. `entries` is always `Record<string, string>` — a SDK's
 * own redaction (e.g. `HakkaConfig.redactMetadata`) has already run before
 * this is built, matching `LogEntry.metadata`'s "already redacted" contract.
 */
export interface StorageSnapshot {
  store: string
  /** Epoch milliseconds this snapshot was captured. */
  timestamp: number
  entries: Record<string, string>
}

export interface HakkaConfig {
  /**
   * Kill switch. Set to `false` to disable Hakka entirely.
   * Default: `true` — Hakka runs in all builds (dev + production).
   *
   * To disable in production, either:
   * - Set `enabled: false` in your config
   * - Use `hakka-network-noop` (Android) / `HakkaNoop` (iOS) for zero-cost stripping
   */
  enabled?: boolean
  /**
   * Interception mode:
   * - `'auto'` (default): native interceptors when available, else JS monkey-patches.
   * - `'native'`: native interceptors only (URLProtocol / OkHttp). Throws from `start()` if unresolvable.
   * - `'js'`: JS monkey-patches only (fetch/XHR/WebSocket). No native module needed.
   * - `'store'`: pure store/aggregator, no interceptors installed — requests come via
   *   `ingest()`/`update()`, full dedup/retention/dispatch still runs (e.g. to host the
   *   engine inside a Web Worker).
   */
  mode?: 'native' | 'js' | 'auto' | 'store'
  /** Max requests in ring buffer. Default: 500 */
  maxRequests?: number
  /** Max body size to capture in bytes. Default: 262144 (256KB) */
  maxBodySize?: number
  /**
   * Byte ceiling for retained request+response bodies across the whole ring
   * buffer. Evicts oldest entries when exceeded, independent of `maxRequests`.
   * Default: 16 MiB.
   */
  maxBufferBytes?: number
  /** Headers to redact (lowercased). Default: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'] */
  redactHeaders?: string[]
  /** Hosts to ignore. Supports wildcards: '*.analytics.com' */
  ignoreHosts?: string[]
  /** URL patterns to ignore. Supports wildcards. */
  ignorePatterns?: string[]
  /** Max age for persisted logs in seconds. Default: 86400 (24h) */
  maxAge?: number
}

/**
 * Semantic status of a captured request — a string-literal union via a
 * const object (not `enum`, which emits runtime code and is nominally
 * typed). `RequestStatus.Success` etc. work as values; `RequestStatus`
 * works as a type.
 */
export const RequestStatus = {
  Pending: 'pending',
  Success: 'success',
  Error: 'error',
  Timeout: 'timeout',
} as const

export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus]

/** Derive RequestStatus from HTTP status code. */
export function getRequestStatus(request: Pick<NetworkRequest, 'status' | 'error' | 'duration'>): RequestStatus {
  if (request.error) return RequestStatus.Error
  if (request.status == null) return RequestStatus.Pending
  if (request.status >= 200 && request.status < 400) return RequestStatus.Success
  return RequestStatus.Error
}

/** Connection status for HakkaBridge WebSocket. */
export type ConnectionStatus =
  | { state: 'disconnected' }
  | { state: 'connecting'; url: string }
  | { state: 'connected'; url: string; since: number }
  | { state: 'error'; url: string; error: string }

export const DEFAULT_CONFIG: Required<
  Pick<
    HakkaConfig,
    'maxRequests' | 'maxBodySize' | 'redactHeaders' | 'ignoreHosts' | 'ignorePatterns' | 'maxAge' | 'maxBufferBytes'
  >
> = {
  maxRequests: 500,
  maxBodySize: 262144,
  redactHeaders: ['authorization', 'proxy-authorization', 'cookie', 'set-cookie'],
  ignoreHosts: [],
  ignorePatterns: [],
  maxAge: 86400,
  // Byte ceiling for RETAINED bodies across the whole ring buffer — the count
  // cap alone admits a ~250MB worst case (500 x two 256KB bodies). Oldest
  // entries evict first once the running body-byte total crosses this line.
  maxBufferBytes: 16 * 1024 * 1024,
}

export type RequestListener = (request: NetworkRequest) => void

/**
 * Shake detection configuration
 */
export interface ShakeConfig {
  /** Enable shake detection to show inspector */
  enabled?: boolean
  /** Shake sensitivity (1.0 = normal, higher = more sensitive) */
  sensitivity?: number
  /** Minimum shake sequences required */
  minShakes?: number
  /** Time window for shake detection in ms */
  timeWindow?: number
}

/**
 * Bubble (draggable bubble) configuration
 */
export interface BubbleConfig {
  /** Initial visibility of bubble on mount */
  showOnInit?: boolean
  /** Bubble size in pixels */
  size?: number
  /**
   * Render the floating monitor in JS or delegate it to the native Hakka
   * overlay. Native rendering avoids React re-renders for the HUD, and matches
   * the `'js' | 'native'` vocabulary `HakkaConfig.mode` already uses for capture.
   */
  renderMode?: 'js' | 'native'
}

/**
 * Inspector visibility state (returned by getVisibility())
 */
export interface InspectorVisibility {
  bubbleVisible: boolean
  inspectorVisible: boolean
}
