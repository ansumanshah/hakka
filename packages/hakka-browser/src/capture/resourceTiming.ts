import { type NetworkRequest, type NetworkTiming } from 'hakka-core'

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
