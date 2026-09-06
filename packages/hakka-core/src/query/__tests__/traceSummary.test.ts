import { describe, expect, test } from 'bun:test'

import type { FrameworkSpan, NetworkRequest } from '../../model/types'
import { summarizeTraceGroup } from '../traceSummary'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: over.id ?? 'r1',
    url: over.url ?? 'https://api.example.com/users',
    method: over.method ?? 'GET',
    status: over.status ?? 200,
    startTime: over.startTime ?? 0,
    ...over,
  }
}

function span(over: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id: over.id ?? 's1',
    traceId: over.traceId ?? 't1',
    parentId: over.parentId ?? null,
    name: over.name ?? 'BaseServer.handleRequest',
    startTime: over.startTime ?? 0,
    endTime: over.endTime ?? 10,
    verbosity: over.verbosity ?? 'primary',
    runtime: over.runtime ?? 'server',
    ...over,
  }
}

describe('summarizeTraceGroup', () => {
  test('cache summary formats "N HIT · M MISS"-style, grouped case-insensitively', () => {
    const summary = summarizeTraceGroup(
      [
        req({ id: 'a', cacheStatus: 'HIT' }),
        req({ id: 'b', cacheStatus: 'hit' }),
        req({ id: 'c', cacheStatus: 'MISS' }),
      ],
      [],
    )
    expect(summary.cacheSummary).toBe('2 HIT · 1 MISS')
  })

  test('cache summary is "No cache data" when every request has cacheStatus null', () => {
    const summary = summarizeTraceGroup([req({ id: 'a' }), req({ id: 'b' })], [])
    expect(summary.cacheSummary).toBe('No cache data')
  })

  test('cache summary ignores requests with no cacheStatus alongside ones that have it', () => {
    const summary = summarizeTraceGroup([req({ id: 'a', cacheStatus: 'STALE' }), req({ id: 'b' })], [])
    expect(summary.cacheSummary).toBe('1 STALE')
  })

  test('slowest picks a span over a request when the span is longer', () => {
    const summary = summarizeTraceGroup(
      [req({ id: 'r', startTime: 0, endTime: 50 })],
      [span({ id: 's', name: 'AppRouteRouteHandlers.runHandler', startTime: 0, endTime: 200 })],
    )
    expect(summary.slowest?.label).toBe('AppRouteRouteHandlers.runHandler')
    expect(summary.slowest?.durationMs).toBe(200)
  })

  test('slowest picks a request over a span when the request is longer', () => {
    const summary = summarizeTraceGroup(
      [req({ id: 'r', url: 'https://api.example.com/slow-path', startTime: 0, endTime: 500 })],
      [span({ id: 's', startTime: 0, endTime: 50 })],
    )
    expect(summary.slowest?.label).toBe('/slow-path')
    expect(summary.slowest?.durationMs).toBe(500)
  })

  test('operationCount is exactly requests.length + spans.length', () => {
    const summary = summarizeTraceGroup(
      [req({ id: 'a' }), req({ id: 'b' }), req({ id: 'c' })],
      [span({ id: 's1' }), span({ id: 's2' })],
    )
    expect(summary.operationCount).toBe(5)
    expect(summary.fetchCount).toBe(3)
  })

  test('method and status come from the earliest-starting request', () => {
    const summary = summarizeTraceGroup(
      [
        req({ id: 'later', method: 'POST', status: 201, startTime: 10 }),
        req({ id: 'root', method: 'GET', status: 200, startTime: 0 }),
      ],
      [],
    )
    expect(summary.method).toBe('GET')
    expect(summary.status).toBe(200)
  })

  test('status is "pending" for the root request when it has no status yet', () => {
    const summary = summarizeTraceGroup([req({ id: 'root', startTime: 0, status: undefined })], [])
    expect(summary.status).toBe('pending')
  })

  test('method, status, and requestKind are null when there are no requests or root spans', () => {
    const summary = summarizeTraceGroup([], [])
    expect(summary.method).toBeNull()
    expect(summary.status).toBeNull()
    expect(summary.requestKind).toBeNull()
    expect(summary.slowest).toBeNull()
  })

  test('requestKind comes from the root span (parentId === null)', () => {
    const summary = summarizeTraceGroup(
      [],
      [
        span({ id: 'child', parentId: 'root', requestKind: undefined, startTime: 5 }),
        span({ id: 'root', parentId: null, requestKind: 'rsc', startTime: 0 }),
      ],
    )
    expect(summary.requestKind).toBe('rsc')
  })
  test('keeps first roots and slowest on ties, and prefers duration over endTime', () => {
    const summary = summarizeTraceGroup(
      [
        req({ id: 'first', method: 'POST', startTime: 1, duration: 25, endTime: 1000 }),
        req({ id: 'tie', method: 'GET', startTime: 1, endTime: 26 }),
      ],
      [
        span({ id: 'later', startTime: 5, requestKind: 'route-handler' }),
        span({ id: 'root', startTime: 1, endTime: 26, requestKind: 'rsc' }),
        span({ id: 'tie', startTime: 1, requestKind: 'server-action' }),
      ],
    )
    expect(summary.method).toBe('POST')
    expect(summary.requestKind).toBe('rsc')
    expect(summary.slowest).toEqual({ label: '/users', durationMs: 25 })
  })
})
