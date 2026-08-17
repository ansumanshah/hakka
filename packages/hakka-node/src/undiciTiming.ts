/**
 * Best-effort connect-phase timing for server-side `fetch()` calls, sourced
 * from undici's `node:diagnostics_channel` events. See
 * [Best-effort undici connect timing](/node/overview/#best-effort-undici-fetch-connect-timing)
 * for the user-facing summary (opt-in, single combined `connectMs`, Bun caveat).
 *
 * The hard part is correlating an undici-side event to the `NetworkRequest`
 * the fetch interceptor emits — there's no shared object between the two:
 *
 *  1. Connect-phase → socket is exact: `undici:client:connected` hands back
 *     the socket itself, so "was THIS socket freshly connected" is a
 *     `WeakMap`/`WeakSet` identity check. Only the first request on a fresh
 *     socket is credited — a reused pooled socket never fabricates a number
 *     (mirrors `httpInterceptor.ts`'s `socket.connecting === false` rule).
 *  2. Socket → NetworkRequest relies on url+method matching, queued per
 *     `METHOD url` key in send order. A `NetworkRequest` only claims an
 *     entry when exactly one is pending for that key — 2+ concurrent
 *     identical calls in flight is ambiguous, so it's left unenriched.
 *     Entries older than `MATCH_WINDOW_MS` are dropped before every check.
 *
 * A record's resolved `connectMs` is cached once per id, because the fetch
 * interceptor emits each fetch TWICE under the same id (headers, then a
 * body-captured update) — re-querying on the second call could hand it a
 * different concurrent request's entry.
 */
import diagnosticsChannel from 'node:diagnostics_channel'

import type { NetworkRequest } from 'hakka-core'

/** How long a queued (unmatched) entry stays eligible for correlation. Bounds both memory and "how recent" a match can be — see the module doc's point 2. */
const MATCH_WINDOW_MS = 5_000
/** Cap on the per-`id` resolved-verdict cache (mirrors `trace.ts`'s clear-on-cap cache: correlationIds/request ids churn per-request, so a full clear on hitting the cap trades a small burst of cache misses for no LRU bookkeeping.) */
const MATCHED_CACHE_LIMIT = 2048

interface UndiciRequestLike {
  origin: string
  path: string
  method: string
}

interface UndiciConnectParamsLike {
  /** `hostname:port`, per undici's `connectParams` shape — used only as an opaque per-origin FIFO key, never parsed. */
  host: string
}

interface PendingConnectEntry {
  /** `undefined` = this request's socket was reused (pooled), not fresh — never fabricated, left absent. */
  connectMs: number | undefined
  createdAt: number
}

export interface UndiciTimingHandle {
  /**
   * Best-effort enrichment: mutates `record.connectMs`/`record.timing.connectMs`
   * in place when (and only when) a safe, unambiguous match was found. No-op for
   * non-`fetch` sources and for any record this module never observed a
   * corresponding undici event for (including on plain non-Node runtimes).
   */
  enrich(record: NetworkRequest): void
  /** Unsubscribe from every diagnostics channel and drop all tracked state. */
  teardown(): void
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node
}

function requestKey(method: string, url: string): string {
  return `${method} ${url}`
}

/** Drop entries older than `MATCH_WINDOW_MS` — called before every read/write of a key's queue so staleness never accumulates. */
function sweep(entries: PendingConnectEntry[]): PendingConnectEntry[] {
  const cutoff = Date.now() - MATCH_WINDOW_MS
  return entries.filter((entry) => entry.createdAt >= cutoff)
}

const NOOP_HANDLE: UndiciTimingHandle = { enrich() {}, teardown() {} }

/** Start best-effort undici connect-phase timing. No-op handle off Node. */
export function enableUndiciTiming(): UndiciTimingHandle {
  if (!isNodeRuntime()) return NOOP_HANDLE

  // ── Phase 1: per-origin connect start → per-socket connect duration ────────
  // `beforeConnect` fires right before undici calls `net.connect`/`tls.connect`
  // for a given origin; `connected` fires once that resolves, handing back the
  // socket. FIFO per origin because undici's pool can have several NEW
  // connections to the same origin in flight at once (its default pool size is
  // >1) — first-opened, first-connected is the same order these fire in.
  const connectStartsByOrigin = new Map<string, number[]>()
  const connectMsBySocket = new WeakMap<object, number>()
  const consumedSockets = new WeakSet<object>()

  function popConnectStart(host: string): number | undefined {
    const queue = connectStartsByOrigin.get(host)
    if (!queue || queue.length === 0) return undefined
    const start = queue.shift()
    if (queue.length === 0) connectStartsByOrigin.delete(host)
    return start
  }

  const onBeforeConnect = (message: unknown): void => {
    try {
      const { connectParams } = message as { connectParams: UndiciConnectParamsLike }
      const queue = connectStartsByOrigin.get(connectParams.host) ?? []
      queue.push(Date.now())
      connectStartsByOrigin.set(connectParams.host, queue)
    } catch {
      /* best-effort — never let a diagnostics callback throw */
    }
  }

  const onConnected = (message: unknown): void => {
    try {
      const { connectParams, socket } = message as { connectParams: UndiciConnectParamsLike; socket: object }
      const start = popConnectStart(connectParams.host)
      if (start !== undefined) connectMsBySocket.set(socket, Date.now() - start)
    } catch {
      /* best-effort */
    }
  }

  const onConnectError = (message: unknown): void => {
    try {
      const { connectParams } = message as { connectParams: UndiciConnectParamsLike }
      // Drop the stale start — no socket will ever pair with a failed connect,
      // and leaving it would let a LATER unrelated connect on this origin wrongly
      // inherit this one's (much earlier) start time.
      popConnectStart(connectParams.host)
    } catch {
      /* best-effort */
    }
  }

  // ── Phase 2: at header-send time, decide fresh-vs-reused, then queue by url+method ──
  const pendingByKey = new Map<string, PendingConnectEntry[]>()

  const onSendHeaders = (message: unknown): void => {
    try {
      const { request, socket } = message as { request: UndiciRequestLike; socket: object }
      let connectMs: number | undefined
      if (connectMsBySocket.has(socket) && !consumedSockets.has(socket)) {
        connectMs = connectMsBySocket.get(socket)
        consumedSockets.add(socket) // only the FIRST request on a fresh socket gets credit
      }
      const key = requestKey(request.method, request.origin + request.path)
      const entries = sweep(pendingByKey.get(key) ?? [])
      entries.push({ connectMs, createdAt: Date.now() })
      pendingByKey.set(key, entries)
    } catch {
      /* best-effort */
    }
  }

  diagnosticsChannel.subscribe('undici:client:beforeConnect', onBeforeConnect)
  diagnosticsChannel.subscribe('undici:client:connected', onConnected)
  diagnosticsChannel.subscribe('undici:client:connectError', onConnectError)
  diagnosticsChannel.subscribe('undici:client:sendHeaders', onSendHeaders)

  // `null` = "resolved, no safe enrichment" (no match, or ambiguous). Distinct
  // from "absent" (not resolved yet) so a legitimately-reused-socket match
  // (connectMs undefined but otherwise a clean single match) doesn't get
  // mistaken for "never looked up" on the fetch interceptor's second (body-
  // arrives) emission for the same id — see the module doc.
  const matchedById = new Map<string, number | null>()

  function resolveConnectMs(record: NetworkRequest): number | null {
    const cached = matchedById.get(record.id)
    if (matchedById.has(record.id)) return cached ?? null

    const key = requestKey(record.method, record.url)
    const entries = sweep(pendingByKey.get(key) ?? [])

    if (entries.length === 0) {
      pendingByKey.delete(key)
      matchedById.set(record.id, null)
      return null
    }
    if (entries.length > 1) {
      // Two-or-more in-flight undici requests to the exact same method+url —
      // no way to tell which entry belongs to THIS record without risking a
      // wrong-record enrichment. Leave the queue as-is (untouched, not
      // consumed): it drains naturally as each of those requests resolves and
      // re-checks its own count, and `sweep()` bounds how long any of them
      // can linger.
      pendingByKey.set(key, entries)
      matchedById.set(record.id, null)
      return null
    }

    const only = entries[0]
    pendingByKey.delete(key)
    if (matchedById.size >= MATCHED_CACHE_LIMIT) matchedById.clear()
    const result = only?.connectMs ?? null
    matchedById.set(record.id, result)
    return result
  }

  return {
    enrich(record: NetworkRequest): void {
      if (record.source !== 'fetch') return
      let connectMs: number | null
      try {
        connectMs = resolveConnectMs(record)
      } catch {
        return // best-effort — never let enrichment break a capture
      }
      if (connectMs === null) return
      record.connectMs = connectMs
      record.timing = { ...record.timing, connectMs, total: record.timing?.total ?? record.duration ?? undefined }
    },
    teardown(): void {
      diagnosticsChannel.unsubscribe('undici:client:beforeConnect', onBeforeConnect)
      diagnosticsChannel.unsubscribe('undici:client:connected', onConnected)
      diagnosticsChannel.unsubscribe('undici:client:connectError', onConnectError)
      diagnosticsChannel.unsubscribe('undici:client:sendHeaders', onSendHeaders)
      connectStartsByOrigin.clear()
      pendingByKey.clear()
      matchedById.clear()
    },
  }
}
