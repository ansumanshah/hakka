import { register, TAG } from 'hakka-browser/elements/filter-bar'

import { createElementWrapper } from './createElementWrapper'

/**
 * Mirrors `ui/persist.ts`'s `SavedFilter` shape — the `hakka:filter-change`
 * event's `detail`. Redeclared here field-for-field since it isn't part of
 * `hakka-browser/elements`'s public type exports; every field is a plain
 * string/number so there's nothing enum-shaped to drift.
 */
export interface HakkaSavedFilter {
  filterText: string
  filterMethod: string
  filterStatus: string
  filterContentType: string
  filterRuntime: string
  sortField: string
  sortOrder: string
  groupBy: string
  durMin?: number
  durMax?: number
  sizeMinKb?: number
  sizeMaxKb?: number
}

/**
 * Props for `<FilterBar>` — mirrors `<hakka-filter-bar>`'s attribute/property
 * surface (`packages/hakka-browser/src/ui/elements/filter-bar.tsx`).
 */
export interface FilterBarProps {
  /** Seeds the shared `FilterViewModel` singleton's NL-mode toggle once, on connect. */
  nlMode?: boolean
  /** Seeds the shared `FilterViewModel` singleton's advanced-panel toggle once, on connect. */
  advancedOpen?: boolean
  /** Optional — used only to rank captured hosts for the search box's suggestions. */
  store?: unknown
  /** A full `FilterViewModel` — bypasses the shared singleton entirely. */
  viewModel?: unknown
  /** Fires on `hakka:filter-change`. */
  onFilterChange?: (detail: HakkaSavedFilter) => void
}

/** Thin React wrapper over `<hakka-filter-bar>`. */
export const FilterBar = createElementWrapper<FilterBarProps>(TAG, register, {
  onFilterChange: 'hakka:filter-change',
})
