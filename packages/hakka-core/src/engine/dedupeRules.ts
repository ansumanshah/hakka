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
  for (const existing of logs.getRecent(20)) {
    if (existing.id === request.id) {
      return existing
    }

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
  return {
    ...secondary,
    ...primary,
    id: existing.id,
  }
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
