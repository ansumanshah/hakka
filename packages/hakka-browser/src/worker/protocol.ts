/**
 * Message protocol between the main thread and the store Worker.
 *
 * The Worker owns the capture store and all heavy post-capture work (dedup,
 * retention, ring buffer, HAR/OTel serialization, filter/search, and the
 * desktop bridge socket). The main thread only runs the interceptors (which
 * must live where `fetch`/XHR/WebSocket exist) plus the lazy inspector UI.
 *
 * All payloads are structured-clone-safe: `NetworkRequest` is plain
 * objects/strings/numbers/null — no streams, blobs, or circular refs.
 */
import type { AdvancedQuery, ConnectionStatus, FrameworkSpan, NetworkRequest } from 'hakka-core'

/** A filter/search query evaluated inside the Worker, off the UI thread. */
export interface StoreQuery {
  /** Case-insensitive substring over URL + method. */
  text?: string
  /** Exact HTTP method (case-insensitive), or empty for any. */
  method?: string
  /** Inclusive [lo, hi] status range, or null for any. */
  statusRange?: [number, number] | null
  /** Substring match over the response `content-type` header, or empty for any. */
  contentType?: string
  /** Filter by capture runtime ('client' | 'server' | 'edge'), or empty for any. */
  runtime?: string
}

/** Subset of HakkaConfig the store (running in the Worker) cares about. */
export interface StoreConfig {
  maxRequests?: number
  maxAge?: number
  /** Host blocklist — `shouldIgnore` runs in the store thread. */
  ignoreHosts?: string[]
  /** URL-pattern blocklist — also evaluated in the store thread. */
  ignorePatterns?: string[]
  /**
   * When true (the default), the store never sends the main thread a
   * captured request's `requestBody`/`responseBody` as part of the live
   * `subscribe()` echo — every other field still crosses. These two fields
   * were the biggest thing Hakka kept resident in the host page's memory for
   * no payoff, since the list view only reads `*BodySize`. Detail and the
   * exporters fetch the real bytes on demand via `getBody`/`getBodies`
   * instead. Set to `false` to restore the pre-`slimEcho` behavior — an
   * escape hatch for code that reads bodies straight off the main-thread
   * mirror instead of going through the store client's body RPCs.
   */
  slimEcho?: boolean
}

/** Options forwarded to `recordsToOtelJson`. */
export interface OtelOptions {
  serviceName?: string
  serviceVersion?: string
  scopeName?: string
  scopeVersion?: string
  resourceAttributes?: Record<string, string>
}

/** A captured request's two body fields, resolved on demand via `getBody`/`getBodies`. */
export interface BodyPair {
  requestBody: string | null
  responseBody: string | null
}

/**
 * Strip `requestBody`/`responseBody` off a captured request before it
 * crosses to the main thread (see `StoreConfig.slimEcho`). Every other
 * field passes through untouched. Both backends route through
 * `storeEngine`'s single `Hakka.onRequest` subscription, so calling this in
 * exactly one place keeps them byte-for-byte identical — see storeEngine.ts.
 *
 * Skips the allocation when there's nothing to strip — `req` is returned
 * as-is rather than a needless shallow copy.
 */
export function stripBodies(req: NetworkRequest): NetworkRequest {
  if (req.requestBody == null && req.responseBody == null) return req
  const { requestBody: _requestBody, responseBody: _responseBody, ...rest } = req
  return rest
}

export type MainToWorker =
  | { type: 'init'; config?: StoreConfig }
  | { type: 'ingest'; req: NetworkRequest }
  | { type: 'update'; partial: Partial<NetworkRequest> & { id: string } }
  // Resource-Timing correlation runs in the Worker: the main thread forwards
  // the timing patch keyed by url + start time, and the Worker matches it to
  // the stored request.
  | { type: 'resourceTiming'; url: string; entryEpochStart: number; patch: Partial<NetworkRequest> }
  | { type: 'clear' }
  | { type: 'configure'; config: StoreConfig }
  | { type: 'subscribe' }
  | { type: 'unsubscribe' }
  | { type: 'snapshot'; rid: number; query?: StoreQuery }
  | { type: 'exportHar'; rid: number }
  | { type: 'exportOtel'; rid: number; options?: OtelOptions }
  | { type: 'exportPostman'; rid: number }
  // Always full-fidelity regardless of slimEcho — that flag only governs
  // what's pushed proactively (see StoreConfig.slimEcho).
  | { type: 'getBody'; rid: number; id: string }
  | { type: 'getBodies'; rid: number; ids: string[] }
  // Full-fidelity search — the slim mirror can't match body-scoped tokens,
  // so the parsed query runs engine-side and only matching ids come back.
  | { type: 'matchIds'; rid: number; query: AdvancedQuery }
  | { type: 'bridgeConnect'; url?: string }
  | { type: 'bridgeDisconnect' }
  // Backfill a trace group's spans on demand — for a group populated before
  // any subscribeSpans callback existed to see them arrive live.
  | { type: 'spansForTrace'; rid: number; traceId: string }

export type WorkerToMain =
  | { type: 'request'; req: NetworkRequest }
  // A Next.js/OTel framework span relayed over the desktop bridge. Only
  // posted while the request-echo subscription is active, same gating as
  // 'request'.
  | { type: 'span'; span: FrameworkSpan }
  | { type: 'cleared' }
  | { type: 'result'; rid: number; value: unknown }
  | { type: 'bridgeStatus'; status: ConnectionStatus }
  // Remote control command received over the bridge (e.g. hakka mcp
  // create_mock). Forwarded to the main thread because the mock/breakpoint/
  // throttle engines live where the interceptors run.
  | { type: 'control'; payload: unknown }
