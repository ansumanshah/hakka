/**
 * StatsViewModel — the view-model behind `<hakka-stats>` (ADR 0003). Owns a
 * full (unfiltered) store mirror, upserted by id — every captured request is
 * dispatched at least twice (a headers-only emit, then again once the body
 * arrives), so a naive prepend would double-count it — plus the single-pass
 * aggregation over it. No `FilterViewModel` dependency: Stats has never
 * applied the Network tab's filter/sort/group state.
 */
import { getRequestStatus, getUniqueDomains, RequestStatus } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'

import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

export type StatusClassBucket = '2xx' | '3xx' | '4xx' | '5xx'
export type MethodBucket = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER'

function statusClassOf(status: number | null | undefined): StatusClassBucket | null {
  if (status == null) return null
  if (status >= 200 && status < 300) return '2xx'
  if (status >= 300 && status < 400) return '3xx'
  if (status >= 400 && status < 500) return '4xx'
  if (status >= 500) return '5xx'
  return null
}

function methodBucketOf(m: string): MethodBucket {
  const upper = m.toUpperCase()
  if (upper === 'GET' || upper === 'POST' || upper === 'PUT' || upper === 'PATCH' || upper === 'DELETE')
    return upper as MethodBucket
  return 'OTHER'
}

/** p95 from a sorted (asc) numeric array. Safe on empty arrays. */
function p95(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const idx = Math.floor(sorted.length * 0.95)
  return sorted[Math.min(idx, sorted.length - 1)] ?? null
}

export interface DurationStats {
  avg: number
  min: number
  max: number
  p95: number | null
  count: number
}

export interface StatsState {
  total: number
  success: number
  error: number
  pending: number
  statusClass: Record<StatusClassBucket, number>
  method: Record<MethodBucket, number>
  bytes: number
  /** null when no completed request has a numeric duration. */
  duration: DurationStats | null
  uniqueHosts: number
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface -- pure display, no mutating intents (ADR 0003 (c): "Events: none — pure display").
export interface StatsIntents {}

export type StatsViewModel = ViewModel<StatsState, StatsIntents> & {
  /** Tear down the store subscription. Only call this on a view-model this instance created. */
  destroy(): void
}

export interface StatsStore {
  getSnapshot(): Promise<NetworkRequest[]>
  subscribe(cb: (req: NetworkRequest) => void): () => void
}

export function createStatsViewModel(opts: { store: StatsStore }): StatsViewModel {
  const emitter = createEmitter()
  let reqs: NetworkRequest[] = []
  let destroyed = false

  function upsert(incoming: NetworkRequest): void {
    const idx = reqs.findIndex((r) => r.id === incoming.id)
    if (idx >= 0) {
      const next = reqs.slice()
      next[idx] = incoming
      reqs = next
    } else {
      reqs = [incoming, ...reqs]
    }
    emitter.notify()
  }

  // Subscribe synchronously before the snapshot promise can resolve, so no
  // live request slips through the gap.
  void opts.store.getSnapshot().then((snap) => {
    if (destroyed) return
    reqs = snap
    emitter.notify()
  })
  const unsubscribe = opts.store.subscribe(upsert)

  function aggregate(): StatsState {
    const statusClass: Record<StatusClassBucket, number> = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
    const method: Record<MethodBucket, number> = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 }
    let success = 0
    let error = 0
    let pending = 0
    let bytes = 0
    const rawDurations: number[] = []

    for (const r of reqs) {
      const s = getRequestStatus(r)
      if (s === RequestStatus.Success) success++
      else if (s === RequestStatus.Error) error++
      else pending++

      const cls = statusClassOf(r.status)
      if (cls != null) statusClass[cls]++

      method[methodBucketOf(r.method)]++

      if (typeof r.responseBodySize === 'number') bytes += r.responseBodySize
      if (typeof r.duration === 'number' && r.duration >= 0) rawDurations.push(r.duration)
    }

    rawDurations.sort((a, b) => a - b)
    let duration: DurationStats | null = null
    if (rawDurations.length > 0) {
      let sum = 0
      for (const d of rawDurations) sum += d
      duration = {
        avg: sum / rawDurations.length,
        min: rawDurations[0] ?? 0,
        max: rawDurations[rawDurations.length - 1] ?? 0,
        p95: p95(rawDurations),
        count: rawDurations.length,
      }
    }

    return {
      total: reqs.length,
      success,
      error,
      pending,
      statusClass,
      method,
      bytes,
      duration,
      uniqueHosts: getUniqueDomains(reqs).length,
    }
  }

  return {
    getSnapshot: aggregate,
    subscribe: emitter.subscribe,
    intents: {},
    destroy() {
      destroyed = true
      unsubscribe()
    },
  }
}
