import type { NetworkRequest } from '../model/types'
import type { RingBuffer } from '../storage/RingBuffer'

/**
 * dedupeRules.ts — merges a duplicate/matching capture into an existing log
 * entry instead of double-recording it (the same request observed via both
 * the native and JS capture layers, or a re-delivered getLogs()/getSnapshot()
 * replay). Composed into the Hakka facade's ingest path.
 */

const DEDUP_WINDOW_MS = 100

/**
 * Find an existing log entry that `request` is a duplicate of — either the
 * exact same id, or a same-url/different-source capture that arrived within
 * `DEDUP_WINDOW_MS` of it (the classic native+JS double-capture case).
 */
export function findDuplicateRequest(logs: RingBuffer, request: NetworkRequest): NetworkRequest | undefined {
  const sameId = logs.get(request.id)
  if (sameId) return sameId
  for (const existing of logs.getRecent(20)) {
    if (
      existing.url === request.url &&
      existing.method === request.method &&
      existing.source !== request.source &&
      Math.abs(existing.startTime - request.startTime) < DEDUP_WINDOW_MS
    ) {
      return existing
    }
  }
  return undefined
}

/** Merge an incoming request into its existing duplicate, keeping the existing entry's id. */
export function mergeDuplicateRequest(existing: NetworkRequest, request: NetworkRequest): NetworkRequest {
  const preferRequest = shouldPreferIncomingRequest(existing, request)
  const primary = preferRequest ? request : existing
  const secondary = preferRequest ? existing : request
  const merged: NetworkRequest = {
    ...secondary,
    ...primary,
    id: existing.id,
  }
  // Browser resource timings enrich the header event before fetch/XHR body capture can finish.
  if (
    existing.id === request.id &&
    existing.source === request.source &&
    (existing.source === 'fetch' || existing.source === 'xhr') &&
    hasMeasuredTiming(existing) &&
    !hasMeasuredTiming(request)
  ) {
    merged.timing = { ...existing.timing, ...merged.timing }
    for (const key of ['dnsMs', 'connectMs', 'tlsMs', 'ttfbMs', 'downloadMs'] as const) {
      const value = existing.timing?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        merged.timing[key] = value
        merged[key] = value
      }
    }
  }
  return merged
}

function hasMeasuredTiming(request: NetworkRequest): boolean {
  return (['dnsMs', 'connectMs', 'tlsMs'] as const).some((key) => Number.isFinite(request.timing?.[key]))
}

function shouldPreferIncomingRequest(existing: NetworkRequest, request: NetworkRequest): boolean {
  const existingPriority = getRequestSourcePriority(existing.source)
  const requestPriority = getRequestSourcePriority(request.source)
  if (existingPriority === requestPriority) {
    return true
  }
  return requestPriority > existingPriority
}

function getRequestSourcePriority(source: NetworkRequest['source']): number {
  return source === 'native' ? 2 : 1
}
