/**
 * Incremental filter+sort cache for `RequestListViewModel`. Kept perfectly in
 * sync with what a full `logs.filter(predicate)` + `sortRequests(...)` pass
 * would produce for the CURRENT predicate/sort spec, but a single record
 * change (a live upsert, an in-place update, a removal) patches it directly
 * (O(log n) insert/reposition) instead of re-deriving it from scratch. A
 * change to the predicate or sort spec itself still needs `rebuild()` — the
 * incremental path only ever holds one record's membership/position constant
 * against a KNOWN-unchanged spec.
 */
import { sortRequests } from 'hakka-core'
import type { NetworkRequest, SortField, SortOrder } from 'hakka-core'

export interface FilteredCache {
  /** Current filtered+sorted view — a live reference, mutated in place by
   * every call below. Callers that hand this out as a snapshot MUST copy it
   * (`.slice()`) first; see `RequestListViewModel.computeFiltered`. */
  readonly items: NetworkRequest[]
  /** Full filter+sort pass over `logs`, replacing the cache wholesale. */
  rebuild(logs: NetworkRequest[], predicate: (r: NetworkRequest) => boolean, field: SortField, order: SortOrder): void
  /** Patch the cache for one record change under a STABLE predicate/sort spec. */
  applyChange(
    next: NetworkRequest,
    prev: NetworkRequest | undefined,
    predicate: (r: NetworkRequest) => boolean,
    field: SortField,
    order: SortOrder,
  ): void
  /** Remove one id (a view-only removal, or a store eviction) if present. */
  remove(id: string): void
  /** Assign a rank to an id newly unshifted onto the front of `logs` (a live
   * arrival) — wins every future sort-key tie against ids already tracked. */
  assignFrontRank(id: string): void
  /** Assign a rank to an id newly pushed onto the end of `logs` (historical
   * backfill) — loses every sort-key tie against ids already tracked. */
  assignBackRank(id: string): void
  /** Whether `id` currently holds a rank (i.e. is a known member of `logs`). */
  hasRank(id: string): boolean
  /** Drop `id`'s rank — call whenever `id` leaves `logs` entirely. */
  deleteRank(id: string): void
  /** Wipe everything (cache, membership, ranks) back to empty. */
  reset(): void
}

export function createFilteredCache(): FilteredCache {
  let items: NetworkRequest[] = []
  let ids: Set<string> = new Set()

  // Tie-break rank per id, standing in for `sortRequests`' original-array-
  // index tie-break without needing `logs`' physical index (which shifts
  // under unshift/splice). A record unshifted onto the front of `logs` (a
  // genuinely new live/imported id) always sits at a smaller index than
  // everything already present, so it gets a rank smaller than any handed out
  // so far — `--frontRankCounter`, strictly decreasing. A record pushed onto
  // the end of `logs` (historical backfill) always sits at a larger index, so
  // it gets `backRankCounter++`, strictly increasing from 0 — structurally
  // always greater than every front rank (which are negative). An in-place
  // update (same id, `logs[idx] = req`) never moves the record's position in
  // `logs`, so it keeps its existing rank. Smaller rank wins a sort-key tie
  // (sorts first), mirroring `a.i - b.i` ascending in `sortRequests`.
  const rank = new Map<string, number>()
  let frontRankCounter = 0
  let backRankCounter = 0

  function rankOf(id: string): number {
    return rank.get(id) ?? 0
  }

  function sortKey(req: NetworkRequest, field: SortField): number {
    switch (field) {
      case 'time':
        return req.startTime
      case 'duration':
        return req.duration ?? (req.endTime != null ? req.endTime - req.startTime : 0)
      case 'size':
        return (req.requestBodySize ?? 0) + (req.responseBodySize ?? 0)
      case 'status':
        return req.status ?? 0
    }
  }

  // Comparator matching `sortRequests`' total order exactly (field value,
  // then the rank tie-break above) — used only to find an insertion point,
  // never to re-sort the whole array.
  function compareForSort(a: NetworkRequest, b: NetworkRequest, field: SortField, order: SortOrder): number {
    const av = sortKey(a, field)
    const bv = sortKey(b, field)
    if (av !== bv) return order === 'asc' ? av - bv : bv - av
    return rankOf(a.id) - rankOf(b.id)
  }

  // Leftmost index in `items` (already in sort order) where `item` should be
  // spliced in to keep it sorted — binary search, O(log n) vs. a full re-sort.
  function findInsertIndex(item: NetworkRequest, field: SortField, order: SortOrder): number {
    let lo = 0
    let hi = items.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      const midItem = items[mid]
      if (midItem !== undefined && compareForSort(midItem, item, field, order) > 0) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  function insert(item: NetworkRequest, field: SortField, order: SortOrder): void {
    const pos = findInsertIndex(item, field, order)
    items.splice(pos, 0, item)
    ids.add(item.id)
  }

  function remove(id: string): void {
    if (!ids.has(id)) return
    const idx = items.findIndex((r) => r.id === id)
    if (idx >= 0) items.splice(idx, 1)
    ids.delete(id)
  }

  return {
    get items() {
      return items
    },
    rebuild(logs, predicate, field, order) {
      items = sortRequests(logs.filter(predicate), field, order)
      ids = new Set(items.map((r) => r.id))
    },
    applyChange(next, prev, predicate, field, order) {
      const id = next.id
      const wasIn = ids.has(id)
      const isIn = predicate(next)

      if (!wasIn && !isIn) return
      if (wasIn && !isIn) {
        remove(id)
        return
      }
      if (!wasIn && isIn) {
        insert(next, field, order)
        return
      }

      // wasIn && isIn: the record stays, but its fields (and so possibly its
      // sort key) changed — reposition only if the key actually moved.
      if (prev !== undefined && sortKey(prev, field) === sortKey(next, field)) {
        const idx = items.findIndex((r) => r.id === id)
        if (idx >= 0) {
          items[idx] = next
          return
        }
      }
      remove(id)
      insert(next, field, order)
    },
    remove,
    assignFrontRank(id) {
      frontRankCounter -= 1
      rank.set(id, frontRankCounter)
    },
    assignBackRank(id) {
      rank.set(id, backRankCounter)
      backRankCounter += 1
    },
    hasRank(id) {
      return rank.has(id)
    },
    deleteRank(id) {
      rank.delete(id)
    },
    reset() {
      items = []
      ids = new Set()
      rank.clear()
      frontRankCounter = 0
      backRankCounter = 0
    },
  }
}
