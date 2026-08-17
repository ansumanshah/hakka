/**
 * startServerCapture — instrument the Next.js server runtime and stream captures
 * to the Hakka inspector.
 *
 * Thin Next-specific wrapper around `hakka-node`'s framework-agnostic capture:
 * this module owns only the `NEXT_RUNTIME` (`'nodejs'` vs `'edge'`) branching
 * that's specific to Next's instrumentation layer — the actual fetch/http
 * interception, trace propagation, and bridge streaming all live in
 * `hakka-node`.
 *
 *   // instrumentation.ts
 *   export async function register() {
 *     if (process.env.NEXT_RUNTIME === 'nodejs') {
 *       const { startServerCapture } = await import('hakka-node/next/server')
 *       startServerCapture()
 *     }
 *   }
 */
import type { NetworkRequest } from 'hakka-core'

import { startCapture, stopCapture, type HakkaNodeCapture, type HakkaNodeOptions } from '../serverCapture'

/** Same shape as `hakka-node`'s `HakkaNodeOptions` — kept as a named export for API compatibility. */
export type ServerCaptureOptions = HakkaNodeOptions
/** Same shape as `hakka-node`'s `HakkaNodeCapture` — kept as a named export for API compatibility. */
export type ServerCapture = HakkaNodeCapture

/**
 * Response headers carrying a cache verdict, in precedence order —
 * `x-nextjs-cache` is Next-specific and closer to the fetch outcome, so it
 * wins when both are present. Values pass through unchanged (never a fixed
 * union): expect `HIT`/`MISS`/`STALE`/`REVALIDATE` and other framework
 * values. A plain outbound data-cache fetch (`next: { revalidate }`) carries
 * NEITHER header, so the badge stays absent in local dev — it lights up only
 * where a layer (Vercel, a self-fetching app, a proxy/CDN) stamps one.
 */
const CACHE_STATUS_HEADERS = ['x-nextjs-cache', 'x-vercel-cache']

/** Case-insensitive header lookup — captured header casing isn't guaranteed across every capture path. */
function findHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const key in headers) {
    if (key.toLowerCase() === lower) return headers[key]
  }
  return undefined
}

/**
 * Set `req.cacheStatus` from a Next/Vercel cache-status response header, if
 * one is present. Mutates `req` in place: this runs as a `sink` — called by
 * `hakka-node`'s `startCapture` BEFORE it forwards the same record to the
 * bridge/other sinks — so mutating here is how the annotation reaches the UI
 * without hakka-node itself (framework-agnostic, owns no Next knowledge)
 * needing to know about cache headers at all.
 */
function annotateCacheStatus(req: NetworkRequest): void {
  for (const header of CACHE_STATUS_HEADERS) {
    const value = findHeader(req.responseHeaders, header)
    if (value) {
      req.cacheStatus = value
      return
    }
  }
}

/**
 * Server-side framework noise dropped by default: Next's anonymous-telemetry
 * posts fail offline and show up as ERR rows that read like app bugs. A
 * caller-provided `ignorePatterns` replaces (not extends) this default —
 * same override semantics as the client entry's ignore list.
 */
const DEFAULT_IGNORE_PATTERNS = ['*telemetry.nextjs.org*']

/** Start server-side capture. Idempotent — a second call returns the live handle. */
export function startServerCapture(options: ServerCaptureOptions = {}): ServerCapture {
  const userSink = options.sink
  return startCapture({
    ignorePatterns: DEFAULT_IGNORE_PATTERNS,
    // Zero-config default: Next Request Insights (span waterfall, request
    // kind) light up in dev without the caller having to opt in — mirrors
    // `register()`'s own dev-only gate. An explicit `options.traceSpans`
    // (true OR false) always wins, since it's spread AFTER this default.
    traceSpans: process.env.NODE_ENV === 'development',
    ...options,
    sink: (req) => {
      annotateCacheStatus(req)
      userSink?.(req)
    },
  })
}

/** Stop the active server capture, if any. */
export function stopServerCapture(): void {
  stopCapture()
}

/**
 * Drop-in Next.js `instrumentation.ts` hook — one line and done:
 *
 *   // instrumentation.ts
 *   export { register } from 'hakka-node/next'
 *
 * Starts server capture (Node runtime, with the bridge hub embedded so there's no
 * separate process). On the Edge runtime it captures `fetch` only. No-op in
 * production. Pass options to customize.
 */
export async function register(options: ServerCaptureOptions = {}): Promise<void> {
  if (process.env.NODE_ENV === 'production' && options.runtime == null) return
  const nextRuntime = process.env.NEXT_RUNTIME
  if (nextRuntime === 'edge') {
    startServerCapture({ ...options, runtime: 'edge', captureHttp: false, embedBridge: false })
    return
  }
  // 'nodejs' or undefined (plain Node / non-Next): full capture + embedded hub.
  startServerCapture({ runtime: 'server', ...options })
}
