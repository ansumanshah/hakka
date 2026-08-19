import { type CaptureSource, type CaptureSourceContext, type NetworkRequest, type NetworkTiming } from 'hakka-core'

import type { StoreClient } from '../worker'

/**
 * Resource Timing enrichment — the browser analog of Hakka's native (OkHttp /
 * URLProtocol) timing layer. The JS fetch/XHR interceptors can only
 * approximate TTFB and download time; the Performance Timeline
 * (`PerformanceObserver` over `resource` entries) exposes the real DNS/TLS/
 * connect/TTFB/download breakdown and negotiated protocol (h2/h3). Entries
 * arrive after a request completes and are forwarded to the store thread,
 * which correlates each to its request by url + start time.
 *
 * Cross-origin entries without `Timing-Allow-Origin` report zeroed timings —
 * those fields are skipped so a zero never clobbers an approximation.
 */
const TIMING_KEYS = ['dnsMs', 'connectMs', 'tlsMs', 'ttfbMs', 'downloadMs'] as const

export function enableResourceTimingEnrichment(client: StoreClient): () => void {
  if (typeof PerformanceObserver === 'undefined' || typeof performance === 'undefined') {
    return () => {}
  }

  const timeOrigin = performance.timeOrigin || 0

  const consume = (entries: readonly PerformanceEntry[]) => {
    for (const raw of entries) {
      const entry = raw as PerformanceResourceTiming
      if (entry.initiatorType !== 'fetch' && entry.initiatorType !== 'xmlhttprequest') continue
      const patch = extractTiming(entry)
      if (Object.keys(patch).length === 0) continue
      client.applyResourceTiming(entry.name, timeOrigin + entry.startTime, patch)
    }
  }

  const observer = new PerformanceObserver((list) => consume(list.getEntries()))
  observer.observe({ type: 'resource', buffered: true })

  return () => observer.disconnect()
}

function extractTiming(e: PerformanceResourceTiming): Partial<NetworkRequest> {
  const flat: Partial<Record<(typeof TIMING_KEYS)[number], number>> = {}
  const timing: NetworkTiming = {}

  const set = (key: (typeof TIMING_KEYS)[number], value: number) => {
    if (Number.isFinite(value) && value > 0) {
      const rounded = Math.round(value)
      flat[key] = rounded
      timing[key] = rounded
    }
  }

  set('dnsMs', e.domainLookupEnd - e.domainLookupStart)
  set('connectMs', e.connectEnd - e.connectStart)
  if (e.secureConnectionStart > 0) set('tlsMs', e.connectEnd - e.secureConnectionStart)
  if (e.responseStart > 0) set('ttfbMs', e.responseStart - e.requestStart)
  set('downloadMs', e.responseEnd - e.responseStart)

  const out: Partial<NetworkRequest> = { ...flat }
  if (e.nextHopProtocol) out.networkProtocol = e.nextHopProtocol
  if (Object.keys(timing).length > 0) out.timing = timing
  return out
}

/**
 * `CaptureSourceContext`-backed equivalent of `storeEngine.applyResourceTiming`
 * (`packages/hakka-browser/src/worker/storeEngine.ts`) — same matching rule
 * (fetch/xhr record, no `timing` yet, closest `startTime` for this url), but
 * against `ctx.getLogs()`'s flat, unindexed snapshot instead of the engine's
 * `Hakka.getLogsByUrl` index. ADR 0006 row 5 names this exact gap: an O(n)
 * filter per timing entry where the engine is O(k) via an indexed url
 * lookup. Accepted debt per the ADR's Consequences section, not solved here.
 */
function applyResourceTimingViaContext(
  ctx: CaptureSourceContext,
  url: string,
  entryEpochStart: number,
  patch: Partial<NetworkRequest>,
): void {
  // A host context wired without enrichment support (both are optional on
  // the contract) — fail open, never throw, matching every other capture
  // path's error semantics.
  if (!ctx.update || !ctx.getLogs) return
  let best: NetworkRequest | undefined
  let bestDelta = Number.POSITIVE_INFINITY
  for (const r of ctx.getLogs()) {
    if (r.url !== url) continue
    if ((r.source !== 'fetch' && r.source !== 'xhr') || r.timing) continue
    const delta = Math.abs(r.startTime - entryEpochStart)
    if (delta < bestDelta) {
      bestDelta = delta
      best = r
    }
  }
  if (best) ctx.update({ id: best.id, ...patch })
}

/**
 * `enableResourceTimingEnrichment` above takes a full `StoreClient`, but its
 * body only ever calls `client.applyResourceTiming(...)` — the only member
 * it touches. Standing up a real `StoreClient` here (ingest/subscribe/
 * exportHar/bridgeConnect/… ~20 members this source has no use for) would be
 * dead weight, so this adapter implements exactly the one method that's
 * actually called, backed by `applyResourceTimingViaContext` above, and
 * casts through `unknown` to satisfy the parameter type. If
 * `enableResourceTimingEnrichment` ever starts calling a second `StoreClient`
 * member, this fails loudly (`x is not a function`), not silently.
 */
function storeClientAdapter(ctx: CaptureSourceContext): StoreClient {
  return {
    applyResourceTiming(url: string, entryEpochStart: number, patch: Partial<NetworkRequest>) {
      applyResourceTimingViaContext(ctx, url, entryEpochStart, patch)
    },
  } as unknown as StoreClient
}

/**
 * `CaptureSource` (ADR 0006) wrapper around `enableResourceTimingEnrichment()`.
 * Row 5 of ADR 0006's mapping table: this is the enricher case — it never
 * calls `ctx.ingest`/`ctx.emitSpan` (`emits via` is "neither new records nor
 * spans"), only `ctx.update` on an already-ingested record via the adapter
 * above. `runtime` is a fixed `'client'` literal: the Performance Timeline
 * (`PerformanceObserver`) is a browser-only API with no server/edge analog,
 * same reasoning as `createWebSocketCaptureSource`'s fixed runtime.
 *
 * `enableResourceTimingEnrichment` itself has no idempotent-start guard (a
 * second call installs a second `PerformanceObserver`, double-enriching) and
 * is otherwise fully synchronous — construct, `observe()`, return a
 * disposer — so unlike the WebSocket/OTel wrappers there is no async gap for
 * a `stopped` flag to close: `PerformanceObserver#disconnect()` stops
 * delivery to its callback before this function returns.
 */
export function createResourceTimingCaptureSource(): CaptureSource {
  let disposer: (() => void) | null = null

  return {
    id: 'hakka.resource-timing',
    runtime: 'client',
    transport: 'resource-timing',
    correlation: 'none',
    start(ctx: CaptureSourceContext) {
      if (disposer) return // already started — idempotent per the CaptureSource contract
      disposer = enableResourceTimingEnrichment(storeClientAdapter(ctx))
    },
    stop() {
      if (!disposer) return // never started, or already stopped — idempotent per the contract
      disposer()
      disposer = null
    },
  }
}
