/**
 * FilterViewModel — filter/sort/group/domain state behind `HakkaInspector.tsx`'s Network
 * tab. RN twin of `packages/hakka-browser/src/ui/viewModels/FilterViewModel.ts` (ADR 0003)
 * but not the same shape: RN never adopted `hakka-core`'s `compileQuery`/`AdvancedQuery`
 * the way web's `Inspector.tsx` did. It filters via `Filters`/`List` using a `Set<string>`
 * of methods, a `StatusGroup` chip, and RN-only `groupSort`/`filterPersist` utils
 * (`sortRequests`/`groupRequests` delegate to `hakka-core`).
 *
 * Recent-filter push fires on `filter`/`methodFilters`/`statusGroup`/`sortBy`/`sortDir`/
 * `groupBy` change, guarded by `!filter && methodFilters.size === 0 && statusGroup === 'all'`.
 * `sortDesc`, `showFilters`, `searchInBody`, `nlMode`, `selectedDomains` are deliberately
 * excluded from that push and from the persisted `FilterSnapshot`.
 */
import { nlToQuery } from 'hakka-core'

import type { FilterSnapshot, SavedFilter } from '../utils/filterPersist'
import {
  addSavedFilter,
  getRecentFilters,
  getSavedFilters,
  initFilterPersist,
  pushRecentFilter,
  removeSavedFilter,
} from '../utils/filterPersist'
import type { GroupBy, SortBy, SortDir } from '../utils/groupSort'
import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

/** Status-class quick filter — 'all' means no constraint. Owned here (not `Filters.tsx`) so the view layer depends on the state layer, never the reverse. */
export type StatusGroup = 'all' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'

function toggledSet(set: Set<string>, value: string): Set<string> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export interface FilterState {
  filter: string
  /** NL-mode-aware query actually passed to `<List>` — `filter` verbatim, or `nlToQuery(filter)` when `nlMode` is on. Mirrors `HakkaInspector.tsx`'s `effectiveFilter` `useMemo`. */
  effectiveFilter: string
  showFilters: boolean
  statusGroup: StatusGroup
  methodFilters: Set<string>
  /** Legacy simple-sort flag — independent of `sortBy`/`sortDir`, matches `HakkaInspector.tsx`'s `sortDesc` (not part of saved/recent snapshots). */
  sortDesc: boolean
  searchInBody: boolean
  nlMode: boolean
  selectedDomains: Set<string>
  groupBy: GroupBy
  sortBy: SortBy
  sortDir: SortDir
  savedFilters: SavedFilter[]
  recentFilters: FilterSnapshot[]
}

export interface FilterIntents {
  setFilter(value: string): void
  /** Explicit open/close — matches `HakkaInspector.tsx`'s "open monitor settings from the bubble HUD, force the filters panel open" call site, which has no web equivalent (`Inspector.tsx` only ever toggles `advOpen`). */
  setShowFilters(value: boolean): void
  toggleFilters(): void
  setStatusGroup(value: StatusGroup): void
  toggleMethod(method: string): void
  toggleSortDesc(): void
  setSearchInBody(value: boolean): void
  setNlMode(value: boolean): void
  toggleDomain(domain: string): void
  setGroupBy(value: GroupBy): void
  setSortBy(value: SortBy): void
  toggleSortDir(): void
  /** Save the current filter/sort/group state under `name`. */
  saveFilter(name: string): void
  /** Restore a full filter/sort/group snapshot (a saved or recent entry). */
  applyFilter(snapshot: FilterSnapshot): void
  removeSavedFilter(name: string): void
}

export type FilterViewModel = ViewModel<FilterState, FilterIntents>

export function createFilterViewModel(): FilterViewModel {
  const emitter = createEmitter()

  // Snapshot identity must stay stable between mutations — see
  // StatsViewModel.ts's note on useSyncExternalStore's identity comparison.
  let snapshot: FilterState | null = null
  const commit = () => {
    snapshot = null
    emitter.notify()
  }

  let filter = ''
  let showFilters = false
  let statusGroup: StatusGroup = 'all'
  let methodFilters = new Set<string>()
  let sortDesc = true
  let searchInBody = false
  let nlMode = false
  let selectedDomains = new Set<string>()
  let groupBy: GroupBy = 'none'
  let sortBy: SortBy = 'time'
  let sortDir: SortDir = 'desc'
  let savedFilters: SavedFilter[] = getSavedFilters()
  let recentFilters: FilterSnapshot[] = getRecentFilters()

  // Mirrors HakkaInspector.tsx's init-filter-persistence effect. Safe to call from
  // multiple instances: initFilterPersist is idempotent against the underlying load.
  initFilterPersist(() => {
    savedFilters = getSavedFilters()
    recentFilters = getRecentFilters()
    commit()
  })

  const snapshotForPersist = (): FilterSnapshot => ({
    query: filter,
    methodFilters: [...methodFilters],
    statusGroup,
    sortBy,
    sortDir,
    groupBy,
  })

  // Mirrors HakkaInspector.tsx's recent-filter effect (same fields, same guard),
  // run once per intent call instead of on a post-render effect flush.
  function afterQueryFieldChange(): void {
    if (filter || methodFilters.size > 0 || statusGroup !== 'all') {
      pushRecentFilter(snapshotForPersist())
      recentFilters = getRecentFilters()
    }
    commit()
  }

  const intents: FilterIntents = {
    setFilter(value) {
      filter = value
      afterQueryFieldChange()
    },
    setShowFilters(value) {
      showFilters = value
      commit()
    },
    toggleFilters() {
      showFilters = !showFilters
      commit()
    },
    setStatusGroup(value) {
      statusGroup = value
      afterQueryFieldChange()
    },
    toggleMethod(method) {
      methodFilters = toggledSet(methodFilters, method)
      afterQueryFieldChange()
    },
    toggleSortDesc() {
      sortDesc = !sortDesc
      commit()
    },
    setSearchInBody(value) {
      searchInBody = value
      commit()
    },
    setNlMode(value) {
      nlMode = value
      commit()
    },
    toggleDomain(domain) {
      selectedDomains = toggledSet(selectedDomains, domain)
      commit()
    },
    setGroupBy(value) {
      groupBy = value
      afterQueryFieldChange()
    },
    setSortBy(value) {
      sortBy = value
      afterQueryFieldChange()
    },
    toggleSortDir() {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc'
      afterQueryFieldChange()
    },
    saveFilter(name) {
      addSavedFilter(name, snapshotForPersist())
      savedFilters = getSavedFilters()
      commit()
    },
    applyFilter(snapshot) {
      // No enum validation here — matches HakkaInspector.tsx's original
      // handleApplyFilter, which cast the snapshot's fields directly.
      filter = snapshot.query
      methodFilters = new Set(snapshot.methodFilters)
      statusGroup = snapshot.statusGroup as StatusGroup
      sortBy = snapshot.sortBy as SortBy
      sortDir = snapshot.sortDir as SortDir
      groupBy = snapshot.groupBy as GroupBy
      afterQueryFieldChange()
    },
    removeSavedFilter(name) {
      removeSavedFilter(name)
      savedFilters = getSavedFilters()
      commit()
    },
  }

  return {
    getSnapshot(): FilterState {
      return (snapshot ??= {
        filter,
        effectiveFilter: nlMode ? nlToQuery(filter) : filter,
        showFilters,
        statusGroup,
        methodFilters,
        sortDesc,
        searchInBody,
        nlMode,
        selectedDomains,
        groupBy,
        sortBy,
        sortDir,
        savedFilters,
        recentFilters,
      })
    },
    subscribe: emitter.subscribe,
    intents,
  }
}
