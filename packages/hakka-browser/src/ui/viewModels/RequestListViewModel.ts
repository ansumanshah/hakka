/**
 * RequestListViewModel — the view-model behind `<hakka-request-list>` (ADR
 * 0003). Owns the live store mirror (upsert-by-id, batched per microtask),
 * the filter/sort/(re)group derivation over it, and the search-suggestion
 * list fed to `<hakka-filter-bar>`. Reads (never mutates) the shared
 * `FilterViewModel` slice — mutation is `<hakka-filter-bar>`'s job (ADR 0003
 * (b)).
 */
import { compileQuery, createGroupCache, deriveTraceId } from 'hakka-core'
import type { FrameworkSpan, NetworkRequest, RequestGroup } from 'hakka-core'

import type { StoreClient } from '../../worker'
import type { ViewModel } from './contract'
import { createEmitter } from './emitter'
import { createFilteredCache } from './filteredCache'
import { toAdvancedQuery, type FilterViewModel } from './FilterViewModel'

// Above this many captured requests, a full filter/sort/(re)group recompute on
// every keystroke gets expensive enough to debounce; below it stays synchronous.
const FILTER_DEBOUNCE_ABOVE = 60
const FILTER_DEBOUNCE_MS = 120

const SCOPE_HINTS = ['host:', 'header:', 'body:', 'status:', 'method:', 'dur>', 'size<']

export interface RequestListState {
  /** Raw store mirror, newest-first — unfiltered, unsorted. */
  logs: NetworkRequest[]
  /** Filtered + sorted (groupBy applied only when non-'none' — see `groups`). */
  filtered: NetworkRequest[]
  /** Non-null when FilterViewModel's groupBy !== 'none'. */
  groups: RequestGroup[] | null
  count: number
  /** True when `filtered.length !== logs.length` (a filter is actively narrowing the list). */
  isFiltered: boolean
  /** True once any captured request carries a non-client runtime (gates the Runtime segmented control). */
  hasServerCaptures: boolean
  /** Ranked suggestions for the search box: recent filter texts, then matching hosts, then scope hints. */
  searchSuggestions: string[]
  /** Framework spans (Next.js/OTel request tree), keyed by traceId — feeds TraceWaterfall/TraceBadgeRow. */
  spansByTrace: ReadonlyMap<string, FrameworkSpan[]>
}

export interface RequestListIntents {
  clearLogs(): void
  loadSampleTraffic(): Promise<void>
  /** Replace a live request in the mirror with a full session/import record (upsert-by-id, same as a live upsert). */
  importRequests(reqs: NetworkRequest[]): void
  /** Remove one request from the mirror only (local UI action — does not touch the store), e.g. the bulk "Remove" button. */
  removeFromView(id: string): void
}

export type RequestListViewModel = ViewModel<RequestListState, RequestListIntents> & {
  /** Tear down the store + filter subscriptions. Only call this on a view-model this instance created — an injected one is owned by its creator. */
  destroy(): void
}

export interface RequestListViewModelOptions {
  store: StoreClient
  filters: FilterViewModel
}

export function createRequestListViewModel(opts: RequestListViewModelOptions): RequestListViewModel {
  const { store, filters } = opts
  const emitter = createEmitter()

  let logs: NetworkRequest[] = []
  let logsVersion = 0
  let lastSeenFilterText = filters.getSnapshot().filterText
  let lastSeenGroupBy = filters.getSnapshot().groupBy
  let debouncedFilterText = lastSeenFilterText
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let storeMatchIds: ReadonlySet<string> | null = null
  let matchSeq = 0
  let destroyed = false

  // The filtered/sorted view over `logs` for the current filter/sort spec —
  // see filteredCache.ts for the incremental-vs-full-rebuild split.
  const filteredCache = createFilteredCache()

  // Framework spans, keyed by traceId. Populated by the live subscribeSpans
  // feed; backfilled per-group via getSpansForTrace on a groupBy->'trace'
  // transition, since spans may have arrived before this view-model existed.
  let spansByTrace = new Map<string, FrameworkSpan[]>()

  const regroup = createGroupCache()

  // Inserts unshift (newest-first), matching the physical position new live
  // arrivals used to get in `logs` — the front-rank assignment below relies
  // on that (see filteredCache.ts). Returns the prior record for an in-place
  // update, `undefined` for a brand-new id.
  function upsertOne(req: NetworkRequest): NetworkRequest | undefined {
    const idx = logs.findIndex((r) => r.id === req.id)
    if (idx >= 0) {
      const prev = logs[idx]
      logs[idx] = req
      return prev
    }
    logs.unshift(req)
    filteredCache.assignFrontRank(req.id)
    return undefined
  }

  // The predicate a live batch/import should test each record against, built
  // once per batch (not per record) from the CURRENT filter/sort spec.
  function currentPredicate(): (r: NetworkRequest) => boolean {
    const filterSnap = filters.getSnapshot()
    const q = toAdvancedQuery(filterSnap, debouncedFilterText)
    return storeMatchIds ? (r) => storeMatchIds!.has(r.id) : compileQuery(q)
  }

  function refreshBodyMatch(): void {
    const filterSnap = filters.getSnapshot()
    const q = toAdvancedQuery(filterSnap, debouncedFilterText)
    const touchesBodies = (q.tokens ?? []).some((t) => (t.scope === 'body' || t.scope === 'all') && t.value !== '')
    if (!touchesBodies) {
      if (storeMatchIds !== null) {
        storeMatchIds = null
        // storeMatchIds gates the predicate itself — this can flip membership
        // for an arbitrary number of records at once, so only a full pass is safe.
        rebuildFilteredCache()
        emitter.notify()
      }
      return
    }
    const seq = ++matchSeq
    void store
      .matchIds(q)
      .then((ids) => {
        if (destroyed || seq !== matchSeq) return
        storeMatchIds = new Set(ids)
        rebuildFilteredCache()
        emitter.notify()
      })
      .catch(() => {
        if (destroyed || seq !== matchSeq) return
        storeMatchIds = null
        rebuildFilteredCache()
        emitter.notify()
      })
  }

  function rebuildFilteredCache(): void {
    const filterSnap = filters.getSnapshot()
    const q = toAdvancedQuery(filterSnap, debouncedFilterText)
    const predicate = storeMatchIds ? (r: NetworkRequest) => storeMatchIds!.has(r.id) : compileQuery(q)
    filteredCache.rebuild(logs, predicate, filterSnap.sortField, filterSnap.sortOrder)
  }

  // Logs already mutated (incrementally) by the caller — filteredCache is
  // already correct, so this is just the body-match refresh + notify.
  function recomputeAndNotifyIncremental(): void {
    refreshBodyMatch()
    emitter.notify()
  }

  // The filter predicate or sort spec changed (or a one-shot bulk load, e.g.
  // backfill, where a full pass is cheaper than N individual inserts) —
  // filteredCache needs a full rebuild before the next read.
  function recomputeAndNotifyFull(): void {
    rebuildFilteredCache()
    refreshBodyMatch()
    emitter.notify()
  }

  // Batch incoming live upserts — a burst of N requests becomes one recompute.
  let upsertBuffer: NetworkRequest[] = []
  let flushScheduled = false
  function flushUpsertBuffer(): void {
    flushScheduled = false
    if (upsertBuffer.length === 0) return
    const batch = upsertBuffer
    upsertBuffer = []
    const filterSnap = filters.getSnapshot()
    const predicate = currentPredicate()
    for (const req of batch) {
      const prev = upsertOne(req)
      filteredCache.applyChange(req, prev, predicate, filterSnap.sortField, filterSnap.sortOrder)
    }
    logsVersion++
    recomputeAndNotifyIncremental()
  }
  function upsert(req: NetworkRequest): void {
    upsertBuffer.push(req)
    if (!flushScheduled) {
      flushScheduled = true
      queueMicrotask(flushUpsertBuffer)
    }
  }

  // Subscribe first so no live request slips through the snapshot gap, then
  // backfill the historical buffer the store already holds (older -> appended).
  const unsubStore = store.subscribe(upsert)
  void store.getSnapshot().then((snap) => {
    if (destroyed) return
    for (const req of snap) {
      if (filteredCache.hasRank(req.id)) continue
      logs.push(req)
      filteredCache.assignBackRank(req.id)
    }
    // One-shot bulk load: a full pass beats N individual splice-inserts.
    recomputeAndNotifyFull()
    // Covers mounting already in groupBy:'trace' (persisted — persist.ts):
    // onFiltersChanged only backfills on a 'none'->'trace' transition, which
    // never fires if 'trace' was the first snapshot ever observed.
    backfillSpansForVisibleGroups()
  })

  function upsertSpan(span: FrameworkSpan): void {
    let bucket = spansByTrace.get(span.traceId)
    if (!bucket) {
      bucket = []
      spansByTrace.set(span.traceId, bucket)
    }
    if (!bucket.some((s) => s.id === span.id)) bucket.push(span)
    // New Map identity so `spansByTrace` reads as fresh for consumers that
    // memoize on it (mirrors `logs`'s array-identity discipline).
    spansByTrace = new Map(spansByTrace)
    emitter.notify()
  }
  // Optional-chained: external StoreClient implementations may predate the
  // span feed — the list then simply renders without span rows.
  const unsubSpans = store.subscribeSpans?.(upsertSpan) ?? (() => {})

  /**
   * Backfill spans for every visible trace group not yet in `spansByTrace`.
   * Spans are keyed by their W3C `traceId` (`deriveTraceId(correlationId)`),
   * not the raw correlationId group key — every lookup here must use the
   * derived form or client-originated groups silently never join their spans.
   */
  function backfillSpansForVisibleGroups(): void {
    const filterSnap = filters.getSnapshot()
    if (filterSnap.groupBy !== 'trace') return
    const groups = regroup(computeFiltered(), 'trace')
    for (const grp of groups) {
      if (!grp.key) continue
      const traceId = deriveTraceId(grp.key)
      if (spansByTrace.has(traceId)) continue
      void store.getSpansForTrace?.(traceId).then((spans) => {
        if (destroyed || spans.length === 0) return
        spansByTrace = new Map(spansByTrace)
        spansByTrace.set(traceId, spans)
        emitter.notify()
      })
    }
  }

  function onFiltersChanged(): void {
    const snap = filters.getSnapshot()
    if (snap.groupBy === 'trace' && lastSeenGroupBy !== 'trace') backfillSpansForVisibleGroups()
    lastSeenGroupBy = snap.groupBy
    if (snap.filterText !== lastSeenFilterText) {
      lastSeenFilterText = snap.filterText
      if (debounceTimer) clearTimeout(debounceTimer)
      if (logs.length <= FILTER_DEBOUNCE_ABOVE) {
        debouncedFilterText = snap.filterText
        recomputeAndNotifyFull()
      } else {
        const captured = snap.filterText
        debounceTimer = setTimeout(() => {
          debouncedFilterText = captured
          recomputeAndNotifyFull()
        }, FILTER_DEBOUNCE_MS)
      }
    } else {
      // Any other filter/sort field (method, status, sort field/order,
      // groupBy, …) changed — the predicate or sort spec moved, so a full
      // pass is required (an incremental patch only holds one record's
      // membership/position constant across a KNOWN-unchanged spec).
      recomputeAndNotifyFull()
    }
  }
  const unsubFilters = filters.subscribe(onFiltersChanged)

  // `filteredCache` is kept correct for the current filter/sort spec by every
  // mutation path above (incremental patch or full rebuild) — this is just an
  // O(n) pointer copy, not a re-filter/re-sort. A copy (not the live array
  // reference) is required: `filteredCache.items` keeps mutating in place
  // after this snapshot is handed out (splice on the next live upsert), and
  // consumers — Solid's `<For>` diffing chief among them — need each
  // snapshot's array to be frozen at the moment it was read, exactly like the
  // pre-incremental `sortRequests()` call this replaces (which also returned
  // a fresh array every time).
  function computeFiltered(): NetworkRequest[] {
    return filteredCache.items.slice()
  }

  function computeSearchSuggestions(filterDisplay: string, recentFilters: { filterText: string }[]): string[] {
    const current = filterDisplay.toLowerCase()
    const results: string[] = []

    for (const rf of recentFilters) {
      const text = rf.filterText
      if (text && !results.includes(text)) results.push(text)
    }

    const seenHosts = new Set<string>()
    for (const req of logs) {
      try {
        const host = new URL(req.url).host
        if (host && !seenHosts.has(host)) {
          seenHosts.add(host)
          if (!current || host.toLowerCase().includes(current)) {
            const entry = `host:${host}`
            if (!results.includes(entry)) results.push(entry)
          }
        }
      } catch {
        // malformed URL
      }
    }

    for (const hint of SCOPE_HINTS) {
      if (!current || hint.startsWith(current)) {
        if (!results.includes(hint)) results.push(hint)
      }
    }

    return results.slice(0, 8)
  }

  const intents: RequestListIntents = {
    clearLogs() {
      store.clear()
      logs = []
      filteredCache.reset()
      logsVersion++
      storeMatchIds = null
      emitter.notify()
    },
    async loadSampleTraffic() {
      const { buildSampleRequests } = await import('../sampleData')
      for (const req of buildSampleRequests()) store.ingest(req)
    },
    importRequests(reqs) {
      const filterSnap = filters.getSnapshot()
      const predicate = currentPredicate()
      for (const req of reqs) {
        const prev = upsertOne(req)
        filteredCache.applyChange(req, prev, predicate, filterSnap.sortField, filterSnap.sortOrder)
      }
      logsVersion++
      recomputeAndNotifyIncremental()
    },
    removeFromView(id) {
      const idx = logs.findIndex((r) => r.id === id)
      if (idx < 0) return
      logs.splice(idx, 1)
      filteredCache.deleteRank(id)
      filteredCache.remove(id)
      logsVersion++
      recomputeAndNotifyIncremental()
    },
  }

  return {
    getSnapshot(): RequestListState {
      const filtered = computeFiltered()
      const filterSnap = filters.getSnapshot()
      const groups = filterSnap.groupBy === 'none' ? null : regroup(filtered, filterSnap.groupBy)
      void logsVersion // recompute always reads live `logs`; this is just to keep the field referenced.
      return {
        logs,
        filtered,
        groups,
        count: logs.length,
        isFiltered: filtered.length !== logs.length,
        hasServerCaptures: logs.some((r) => r.runtime && r.runtime !== 'client'),
        searchSuggestions: computeSearchSuggestions(filterSnap.filterDisplay, filterSnap.recentFilters),
        spansByTrace,
      }
    },
    subscribe: emitter.subscribe,
    intents,
    destroy() {
      destroyed = true
      unsubStore()
      unsubSpans()
      unsubFilters()
      if (debounceTimer) clearTimeout(debounceTimer)
    },
  }
}
