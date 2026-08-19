/**
 * hakka-node — framework-agnostic server-side network capture for Node
 * backends (plain `http`, Express, Fastify, Hono, or any other Node server).
 *
 * Instruments `fetch` + Node `http`/`https`, tags every record with `runtime`
 * (default `'server'`), and streams captures into the Hakka inspector so
 * server and client requests show up in one UI. In-process instrumentation —
 * no proxy, no CA cert.
 *
 *   import { register } from 'hakka-node'
 *   register()
 *
 * `register()` is dev-only: it no-ops unless `NODE_ENV === 'development'` or
 * `force: true` is passed, so it's always safe to leave in production code.
 */
// Set before importing the bridge client (transitively pulls in `ws`) — cheap
// insurance for any bundler-based consumer of this package. See wsCompat.ts.
if (typeof process !== 'undefined' && process.env) {
  process.env.WS_NO_BUFFER_UTIL ??= '1'
}

export { register, startCapture, stopCapture, type HakkaNodeOptions, type HakkaNodeCapture } from './serverCapture'
export { enableHttpInterceptor, disableHttpInterceptor, DEFAULT_BRIDGE_HOSTS } from './httpInterceptor'
// `CaptureSource` wrapper around the interceptor above (ADR 0006).
export { createHttpCaptureSource } from './httpInterceptor'
export type { HttpCaptureSourceOptions } from './httpInterceptor'
export {
  enableTracePropagation,
  disableTracePropagation,
  currentServerTraceId,
  currentTraceContext,
  runInTraceContext,
  cohortGate,
  parseIncomingTraceId,
  parseTraceparent,
  parseRequestKindHint,
  buildTraceparent,
  adoptOtelTraceId,
  TRACEPARENT_HEADER,
  type TraceContext,
} from './trace'
export { enableTraceparentFetch, disableTraceparentFetch } from './traceparentFetch'
export { createBridgeClient, DEFAULT_BRIDGE_URL, type BridgeClient, type BridgeClientOptions } from './bridgeClient'
export {
  enableTraceSpans,
  createOtelSpanCaptureSource,
  hakkaSpanProcessor,
  type HakkaSpanProcessor,
  type SpanProcessorHandle,
} from './spanProcessor'
export type { FrameworkSpan, NetworkRequest, RequestKind, RequestRuntime } from 'hakka-core'

export const HAKKA_NODE_VERSION = '0.1.0'
