/**
 * Group-by and sort-by utilities for the request list.
 *
 * Thin adapters over the platform-neutral core query engine
 * (sortRequests / groupRequests from hakka-core).  The RN UI
 * still uses its own SortBy / SortDir type aliases (matching
 * SortField / SortOrder in core) and a GroupBy that is a
 * subset of the core's GroupBy union.
 */

import type { NetworkRequest } from 'hakka-core'
import { sortRequests as coreSortRequests, groupRequests as coreGroupRequests } from 'hakka-core'
import type { GroupBy as CoreGroupBy, RequestGroup as CoreRequestGroup } from 'hakka-core'

/** Sort field — mirrors core SortField. */
export type SortBy = 'time' | 'duration' | 'size' | 'status'
/** Sort direction — mirrors core SortOrder. */
export type SortDir = 'asc' | 'desc'
/**
 * GroupBy values available in the RN inspector.
 * 'status-class' is a UI alias for the core 'status' group.
 */
export type GroupBy = 'none' | 'host' | 'status-class' | 'method'

export interface RequestGroup {
  key: string
  title: string
  data: NetworkRequest[]
}

/** Map the RN 'status-class' alias to the core 'status' key. */
function toCoreGroupBy(by: GroupBy): CoreGroupBy {
  return by === 'status-class' ? 'status' : (by as CoreGroupBy)
}

/** Map a core RequestGroup (uses .label / .items) to the RN shape (.title / .data). */
function fromCoreGroup(g: CoreRequestGroup): RequestGroup {
  return { key: g.key, title: g.label, data: g.items }
}

/** Stable-sorted copy of `logs`; delegates to core's `sortRequests`. */
export function sortRequests(logs: NetworkRequest[], sortBy: SortBy, sortDir: SortDir): NetworkRequest[] {
  return coreSortRequests(logs, sortBy, sortDir)
}

/** Groups `logs` by `groupBy` (each group sorted by `sortBy`/`sortDir`), in insertion order of first occurrence. */
export function groupRequests(
  logs: NetworkRequest[],
  groupBy: GroupBy,
  sortBy: SortBy,
  sortDir: SortDir,
): RequestGroup[] {
  const sorted = coreSortRequests(logs, sortBy, sortDir)
  const coreGroups = coreGroupRequests(sorted, toCoreGroupBy(groupBy))
  return coreGroups.map(fromCoreGroup)
}
