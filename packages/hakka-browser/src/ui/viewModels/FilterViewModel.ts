/**
 * FilterViewModel — the shared filter/sort/group slice named in ADR 0003 (a).
 * Read by `<hakka-request-list>`, `<hakka-waterfall>`, and `<hakka-stats>`;
 * mutated exclusively by `<hakka-filter-bar>`'s intents (ADR 0003 (b)).
 *
 * Deliberately not a god-object: owns only filter/sort/group state. Multi-
 * select lives in `SelectionViewModel`; diff-pair, command palette, tour,
 * and drag-position stay Inspector-shell-only per the ADR.
 */
import { nlToQuery, parseRangeFilters, parseSearchTokens, parseStatusDsl } from 'hakka-core'
import type { AdvancedQuery, GroupBy, SortField, SortOrder } from 'hakka-core'

import {
  addSavedFilter,
  loadUiState,
  pushRecentFilter,
  removeSavedFilter,
  saveUiState,
  type SavedFilter,
} from '../persist'
import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

/** Status-class quick filter — 'all' means no constraint. Owned here, not
 * `FilterBar.tsx`, so the view layer depends on the state layer, never the
 * reverse. */
export type StatusChip = 'all' | '1xx' | '2xx' | '3xx' | '4xx' | '5xx'
export const STATUS_CHIPS: StatusChip[] = ['all', '1xx', '2xx', '3xx', '4xx', '5xx']

// Static option lists, kept in sync with the filter engine's own vocabulary.
export const CONTENT_TYPES: { id: string; label: string; match: string }[] = [
  { id: 'all', label: 'All', match: '' },
  { id: 'json', label: 'JSON', match: 'json' },
  { id: 'html', label: 'HTML', match: 'html' },
  { id: 'js', label: 'JS', match: 'javascript' },
  { id: 'css', label: 'CSS', match: 'css' },
  { id: 'image', label: 'Img', match: 'image' },
  { id: 'font', label: 'Font', match: 'font' },
]

/** Sort field + direction collapsed into one human-readable option each.
 * Every (field, order) pair is listed so a restored saved filter always
 * matches an option. */
export const SORT_COMBOS: { id: string; label: string; field: SortField; order: SortOrder }[] = [
  { id: 'time-desc', label: 'Newest', field: 'time', order: 'desc' },
  { id: 'time-asc', label: 'Oldest', field: 'time', order: 'asc' },
  { id: 'duration-desc', label: 'Slowest', field: 'duration', order: 'desc' },
  { id: 'duration-asc', label: 'Fastest', field: 'duration', order: 'asc' },
  { id: 'size-desc', label: 'Largest', field: 'size', order: 'desc' },
  { id: 'size-asc', label: 'Smallest', field: 'size', order: 'asc' },
  { id: 'status-desc', label: 'Errors first', field: 'status', order: 'desc' },
  { id: 'status-asc', label: 'Successes first', field: 'status', order: 'asc' },
]

export const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'host', label: 'Host' },
  { value: 'status', label: 'Status' },
  { value: 'method', label: 'Method' },
  { value: 'error', label: 'Error' },
  { value: 'trace', label: 'Trace' },
]

export const RUNTIMES: { id: string; label: string }[] = [
  { id: 'all', label: 'All runtimes' },
  { id: 'client', label: 'Client' },
  { id: 'server', label: 'Server' },
  { id: 'edge', label: 'Edge' },
]

const VALID_SORT_FIELDS: ReadonlySet<SortField> = new Set(['time', 'duration', 'size', 'status'])
const VALID_GROUP_BY: ReadonlySet<GroupBy> = new Set(['none', 'host', 'status', 'method', 'error', 'trace'])

/** Status chip -> inclusive [min, max] HTTP status range, or null for 'all'. */
function statusCodeRange(chip: StatusChip): [number, number] | null {
  switch (chip) {
    case '1xx':
      return [100, 199]
    case '2xx':
      return [200, 299]
    case '3xx':
      return [300, 399]
    case '4xx':
      return [400, 499]
    case '5xx':
      return [500, 599]
    default:
      return null
  }
}

interface NlExtraction {
  text: string
  statusDsl: string | null
  method: string | null
}

/**
 * `nlToQuery` emits a DSL string that may carry leading `status:<dsl>` /
 * `method:<VERB>` prefix fragments — pull those into the structured
 * statusDsl/method fields the UI already tracks separately from the free-text
 * query, leaving whatever's left as the search text.
 */
function extractStatusAndMethod(dsl: string): NlExtraction {
  const parts = dsl.split(/\s+/).filter(Boolean)
  const rest: string[] = []
  let statusDsl: string | null = null
  let method: string | null = null
  for (const part of parts) {
    const statusMatch = /^status:(.+)$/i.exec(part)
    const methodMatch = /^method:([a-z]+)$/i.exec(part)
    if (statusMatch && parseStatusDsl(statusMatch[1]!)) {
      statusDsl = statusMatch[1]!
    } else if (methodMatch) {
      method = methodMatch[1]!.toUpperCase()
    } else {
      rest.push(part)
    }
  }
  return { text: rest.join(' '), statusDsl, method }
}

export interface FilterState {
  /** The DSL text `RequestListViewModel`'s predicate actually consumes. */
  filterText: string
  /** What the search box shows — differs from `filterText` only in NL mode. */
  filterDisplay: string
  nlMode: boolean
  /** Raw status DSL fragment extracted from the last NL query (full fidelity — e.g. ">=400"). */
  nlStatusDsl: string | null
  methodFilter: string
  statusChip: StatusChip
  contentType: string
  runtimeFilter: string
  durMin: number
  durMax: number
  sizeMinKb: number
  sizeMaxKb: number
  /** Whether the duration/size range inputs are shown (independent of whether a range is set). */
  showRange: boolean
  sortField: SortField
  sortOrder: SortOrder
  groupBy: GroupBy
  /** Show verbose (non-primary) framework spans in the trace waterfall — persisted like sortField/groupBy. */
  verboseSpans: boolean
  /** Advanced-filter disclosure open state. */
  advOpen: boolean
  savedFilters: { name: string; query: SavedFilter }[]
  recentFilters: SavedFilter[]
  /** Derived: true when any duration/size range bound is set. */
  hasRange: boolean
  /** Derived: count of active advanced filters, shown on the "Filters +n" chip. */
  advancedCount: number
}

export interface FilterIntents {
  /** NL-aware search-box input handler. */
  setFilterText(value: string): void
  setMethodFilter(value: string): void
  setStatusChip(value: StatusChip): void
  setContentType(value: string): void
  setRuntimeFilter(value: string): void
  setDurMin(value: number): void
  setDurMax(value: number): void
  setSizeMinKb(value: number): void
  setSizeMaxKb(value: number): void
  clearRange(): void
  toggleShowRange(): void
  setSortField(value: SortField): void
  setSortOrder(value: SortOrder): void
  toggleSortOrder(): void
  setGroupBy(value: GroupBy): void
  setVerboseSpans(value: boolean): void
  toggleAdvanced(): void
  toggleNlMode(): void
  /** Save the current filter/sort/group state under `name`. */
  saveFilter(name: string): void
  /** Restore a full filter/sort/group snapshot (a saved or recent entry). */
  applyFilter(query: SavedFilter): void
  removeSavedFilter(name: string): void
}

export type FilterViewModel = ViewModel<FilterState, FilterIntents>

function hasRangeOf(s: Pick<FilterState, 'durMin' | 'durMax' | 'sizeMinKb' | 'sizeMaxKb'>): boolean {
  return s.durMin > 0 || s.durMax > 0 || s.sizeMinKb > 0 || s.sizeMaxKb > 0
}

function advancedCountOf(
  s: Pick<
    FilterState,
    'contentType' | 'runtimeFilter' | 'sortField' | 'sortOrder' | 'groupBy' | 'methodFilter' | 'statusChip'
  > & {
    hasRange: boolean
  },
): number {
  return (
    (s.methodFilter !== '' ? 1 : 0) +
    (s.statusChip !== 'all' ? 1 : 0) +
    (s.contentType !== 'all' && s.contentType !== '' ? 1 : 0) +
    (s.runtimeFilter !== 'all' && s.runtimeFilter !== '' ? 1 : 0) +
    (s.hasRange ? 1 : 0) +
    (s.groupBy !== 'none' ? 1 : 0) +
    (s.sortField !== 'time' || s.sortOrder !== 'desc' ? 1 : 0)
  )
}

/** Build the compiled-query input from the current filter state + a (possibly debounced) search text. Owned here so `RequestListViewModel`, and any future consumer, share one translation from UI state to `hakka-core`'s query shape. */
export function toAdvancedQuery(
  state: Pick<
    FilterState,
    | 'statusChip'
    | 'nlStatusDsl'
    | 'methodFilter'
    | 'contentType'
    | 'runtimeFilter'
    | 'durMin'
    | 'durMax'
    | 'sizeMinKb'
    | 'sizeMaxKb'
  >,
  searchText: string,
): AdvancedQuery {
  const statusRange = statusCodeRange(state.statusChip)
  const { ranges, rest } = parseRangeFilters(searchText)
  const uiRanges: { durationMin?: number; durationMax?: number; sizeMin?: number; sizeMax?: number } = {}
  if (state.durMin > 0) uiRanges.durationMin = state.durMin
  if (state.durMax > 0) uiRanges.durationMax = state.durMax
  if (state.sizeMinKb > 0) uiRanges.sizeMin = state.sizeMinKb * 1024
  if (state.sizeMaxKb > 0) uiRanges.sizeMax = state.sizeMaxKb * 1024
  return {
    tokens: parseSearchTokens(rest),
    statusDsl: state.nlStatusDsl ?? (statusRange ? `${statusRange[0]}..${statusRange[1]}` : undefined),
    method: state.methodFilter || undefined,
    contentType: CONTENT_TYPES.find((c) => c.id === state.contentType)?.match || undefined,
    runtime: state.runtimeFilter === 'all' ? undefined : state.runtimeFilter,
    ...ranges,
    ...uiRanges,
  }
}

export function createFilterViewModel(): FilterViewModel {
  const saved = loadUiState()
  const emitter = createEmitter()

  let filterText = saved.filterText
  let filterDisplay = saved.filterText
  let nlMode = false
  let nlStatusDsl: string | null = null
  let methodFilter = saved.filterMethod
  let statusChip = (STATUS_CHIPS.includes(saved.filterStatus as StatusChip) ? saved.filterStatus : 'all') as StatusChip
  let contentType = saved.filterContentType
  let runtimeFilter = saved.filterRuntime
  let durMin = saved.durMin
  let durMax = saved.durMax
  let sizeMinKb = saved.sizeMinKb
  let sizeMaxKb = saved.sizeMaxKb
  let sortField = (VALID_SORT_FIELDS.has(saved.sortField as SortField) ? saved.sortField : 'time') as SortField
  let sortOrder: SortOrder = saved.sortOrder === 'asc' ? 'asc' : 'desc'
  let groupBy = (VALID_GROUP_BY.has(saved.groupBy as GroupBy) ? saved.groupBy : 'none') as GroupBy
  let verboseSpans = saved.verboseSpans
  let showRange = hasRangeOf({ durMin, durMax, sizeMinKb, sizeMaxKb })
  let advOpen =
    advancedCountOf({
      methodFilter,
      statusChip,
      contentType,
      runtimeFilter,
      sortField,
      sortOrder,
      groupBy,
      hasRange: showRange,
    }) > 0
  let savedFilters = saved.savedFilters
  let recentFilters = saved.recentFilters

  const snapshotFor = (): SavedFilter => ({
    filterText,
    filterMethod: methodFilter,
    filterStatus: statusChip,
    filterContentType: contentType,
    filterRuntime: runtimeFilter,
    sortField,
    sortOrder,
    groupBy,
    durMin,
    durMax,
    sizeMinKb,
    sizeMaxKb,
  })

  /** Persists filter state — one write per intent call. */
  const persist = () => {
    saveUiState({
      filterText,
      filterMethod: methodFilter,
      filterStatus: statusChip,
      filterContentType: contentType,
      filterRuntime: runtimeFilter,
      durMin,
      durMax,
      sizeMinKb,
      sizeMaxKb,
      sortField,
      sortOrder,
      groupBy,
      verboseSpans,
    })
  }

  /** Pushes to recentFilters whenever filterText changes and is non-empty. */
  const maybePushRecent = (previousText: string) => {
    if (!filterText || filterText === previousText) return
    pushRecentFilter(snapshotFor())
    recentFilters = loadUiState().recentFilters
  }

  const commit = (previousText: string) => {
    persist()
    maybePushRecent(previousText)
    emitter.notify()
  }

  const intents: FilterIntents = {
    setFilterText(value) {
      const previousText = filterText
      filterDisplay = value
      if (!nlMode) {
        filterText = value
        commit(previousText)
        return
      }
      const dsl = nlToQuery(value)
      const extracted = extractStatusAndMethod(dsl)
      filterText = extracted.text
      nlStatusDsl = extracted.statusDsl
      if (extracted.method) methodFilter = extracted.method
      commit(previousText)
    },
    setMethodFilter(value) {
      methodFilter = value
      commit(filterText)
    },
    setStatusChip(value) {
      statusChip = value
      commit(filterText)
    },
    setContentType(value) {
      contentType = value
      commit(filterText)
    },
    setRuntimeFilter(value) {
      runtimeFilter = value
      commit(filterText)
    },
    setDurMin(value) {
      durMin = value
      commit(filterText)
    },
    setDurMax(value) {
      durMax = value
      commit(filterText)
    },
    setSizeMinKb(value) {
      sizeMinKb = value
      commit(filterText)
    },
    setSizeMaxKb(value) {
      sizeMaxKb = value
      commit(filterText)
    },
    clearRange() {
      durMin = 0
      durMax = 0
      sizeMinKb = 0
      sizeMaxKb = 0
      commit(filterText)
    },
    toggleShowRange() {
      showRange = !showRange
      emitter.notify()
    },
    setSortField(value) {
      sortField = value
      commit(filterText)
    },
    setSortOrder(value) {
      sortOrder = value
      commit(filterText)
    },
    toggleSortOrder() {
      sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      commit(filterText)
    },
    setGroupBy(value) {
      groupBy = value
      commit(filterText)
    },
    setVerboseSpans(value) {
      verboseSpans = value
      commit(filterText)
    },
    toggleAdvanced() {
      advOpen = !advOpen
      emitter.notify()
    },
    toggleNlMode() {
      nlMode = !nlMode
      if (!nlMode) {
        filterDisplay = filterText
        nlStatusDsl = null
      }
      emitter.notify()
    },
    saveFilter(name) {
      addSavedFilter(name, snapshotFor())
      savedFilters = loadUiState().savedFilters
      emitter.notify()
    },
    applyFilter(query) {
      const previousText = filterText
      filterText = query.filterText
      filterDisplay = query.filterText
      methodFilter = query.filterMethod
      statusChip = (STATUS_CHIPS.includes(query.filterStatus as StatusChip) ? query.filterStatus : 'all') as StatusChip
      contentType = query.filterContentType
      runtimeFilter = query.filterRuntime
      sortField = (VALID_SORT_FIELDS.has(query.sortField as SortField) ? query.sortField : 'time') as SortField
      sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc'
      groupBy = (VALID_GROUP_BY.has(query.groupBy as GroupBy) ? query.groupBy : 'none') as GroupBy
      durMin = query.durMin ?? 0
      durMax = query.durMax ?? 0
      sizeMinKb = query.sizeMinKb ?? 0
      sizeMaxKb = query.sizeMaxKb ?? 0
      showRange = hasRangeOf({ durMin, durMax, sizeMinKb, sizeMaxKb })
      commit(previousText)
    },
    removeSavedFilter(name) {
      removeSavedFilter(name)
      savedFilters = loadUiState().savedFilters
      emitter.notify()
    },
  }

  return {
    getSnapshot(): FilterState {
      const hasRange = hasRangeOf({ durMin, durMax, sizeMinKb, sizeMaxKb })
      return {
        filterText,
        filterDisplay,
        nlMode,
        nlStatusDsl,
        methodFilter,
        statusChip,
        contentType,
        runtimeFilter,
        durMin,
        durMax,
        sizeMinKb,
        sizeMaxKb,
        showRange,
        sortField,
        sortOrder,
        groupBy,
        verboseSpans,
        advOpen,
        savedFilters,
        recentFilters,
        hasRange,
        advancedCount: advancedCountOf({
          methodFilter,
          statusChip,
          contentType,
          runtimeFilter,
          sortField,
          sortOrder,
          groupBy,
          hasRange,
        }),
      }
    },
    subscribe: emitter.subscribe,
    intents,
  }
}
