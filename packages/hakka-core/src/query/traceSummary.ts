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

/** Summarize requests and spans, retaining the first item when times tie. */
export function summarizeTraceGroup(requests: NetworkRequest[], spans: FrameworkSpan[]): TraceBadgeSummary {
  let rootRequest: NetworkRequest | undefined
  let rootSpan: FrameworkSpan | undefined
  let slowest: NetworkRequest | FrameworkSpan | undefined
  let slowestDuration = 0
  const counts = new Map<string, number>()
  for (const req of requests) {
    if (!rootRequest || req.startTime < rootRequest.startTime) rootRequest = req
    if (req.cacheStatus != null) {
      const key = req.cacheStatus.toUpperCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const duration = req.duration ?? (req.endTime ?? req.startTime) - req.startTime
    if (!slowest || duration > slowestDuration) {
      slowest = req
      slowestDuration = duration
    }
  }
  for (const span of spans) {
    if (span.parentId === null && (!rootSpan || span.startTime < rootSpan.startTime)) rootSpan = span
    const duration = span.endTime - span.startTime
    if (!slowest || duration > slowestDuration) {
      slowest = span
      slowestDuration = duration
    }
  }

  return {
    method: rootRequest?.method ?? null,
    status: rootRequest ? (rootRequest.status ?? 'pending') : null,
    requestKind: rootSpan?.requestKind ?? null,
    fetchCount: requests.length,
    cacheSummary: [...counts].map(([status, count]) => `${count} ${status}`).join(' · ') || 'No cache data',
    operationCount: requests.length + spans.length,
    slowest: slowest
      ? {
          label:
            'url' in slowest
              ? getRequestDisplayName(slowest.url, slowest.requestBody ?? undefined, slowest.requestHeaders)
              : slowest.name,
          durationMs: slowestDuration,
        }
      : null,
  }
}
