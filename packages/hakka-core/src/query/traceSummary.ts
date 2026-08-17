/**
 * summarizeTraceGroup — badge-row summary for one trace group (requests +
 * spans), backing `TraceBadgeRow.tsx`. Pure, no DOM. Platform-neutral.
 */

import type { FrameworkSpan, NetworkRequest, RequestKind } from '../model/types'
import { getRequestDisplayName } from '../utils/graphql'

export interface TraceBadgeSummary {
  method: string | null
  status: number | 'pending' | null
  requestKind: RequestKind | null
  fetchCount: number
  cacheSummary: string
  operationCount: number
  slowest: { label: string; durationMs: number } | null
}

/** End of a request on the wall clock — endTime, else start+duration, else start. */
function hopEnd(req: NetworkRequest): number {
  if (req.endTime != null) return req.endTime
  if (req.duration != null) return req.startTime + req.duration
  return req.startTime
}

function requestDurationMs(req: NetworkRequest): number {
  if (req.duration != null) return req.duration
  return hopEnd(req) - req.startTime
}

function spanDurationMs(span: FrameworkSpan): number {
  return span.endTime - span.startTime
}

/** `"N HIT · M MISS"`-style summary, grouped by `cacheStatus` case-insensitively. `'No cache data'` when every request has `cacheStatus == null`. */
function summarizeCacheStatuses(requests: NetworkRequest[]): string {
  const counts = new Map<string, number>()
  for (const req of requests) {
    if (req.cacheStatus == null) continue
    const key = req.cacheStatus.toUpperCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (counts.size === 0) return 'No cache data'
  return [...counts.entries()].map(([status, count]) => `${count} ${status}`).join(' · ')
}

/** The root request's method — the request with the earliest `startTime`, or null when there are none. */
function rootMethod(requests: NetworkRequest[]): string | null {
  if (requests.length === 0) return null
  const root = requests.reduce((a, b) => (b.startTime < a.startTime ? b : a))
  return root.method
}

/** The root request's status — the request with the earliest `startTime`; `'pending'` when it has no status yet. */
function rootStatus(requests: NetworkRequest[]): number | 'pending' | null {
  if (requests.length === 0) return null
  const root = requests.reduce((a, b) => (b.startTime < a.startTime ? b : a))
  return root.status ?? 'pending'
}

/** The root span's `requestKind` — the span with `parentId === null`, preferring the earliest-starting one if several. */
function rootRequestKind(spans: FrameworkSpan[]): RequestKind | null {
  const roots = spans.filter((s) => s.parentId === null)
  if (roots.length === 0) return null
  const root = roots.reduce((a, b) => (b.startTime < a.startTime ? b : a))
  return root.requestKind ?? null
}

/**
 * Summarize a trace group for `TraceBadgeRow.tsx`. `operationCount` is
 * exactly `requests.length + spans.length`. `slowest` scans both requests
 * and spans for the single longest duration; label reuses
 * `getRequestDisplayName` for a request, `span.name` for a span.
 */
export function summarizeTraceGroup(requests: NetworkRequest[], spans: FrameworkSpan[]): TraceBadgeSummary {
  let slowest: { label: string; durationMs: number } | null = null

  for (const req of requests) {
    const durationMs = requestDurationMs(req)
    if (slowest === null || durationMs > slowest.durationMs) {
      slowest = { label: getRequestDisplayName(req.url, req.requestBody ?? undefined, req.requestHeaders), durationMs }
    }
  }
  for (const span of spans) {
    const durationMs = spanDurationMs(span)
    if (slowest === null || durationMs > slowest.durationMs) {
      slowest = { label: span.name, durationMs }
    }
  }

  return {
    method: rootMethod(requests),
    status: rootStatus(requests),
    requestKind: rootRequestKind(spans),
    fetchCount: requests.length,
    cacheSummary: summarizeCacheStatuses(requests),
    operationCount: requests.length + spans.length,
    slowest,
  }
}
