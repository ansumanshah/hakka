/**
 * Headless view-model layer — ADR 0003. See `contract.ts` for the shared
 * `{ getSnapshot, subscribe, intents }` shape every view-model implements.
 *
 * Shared slices (ADR 0003 (a)): `FilterViewModel`, `SelectionViewModel`.
 * Per-component: `RequestListViewModel`, `RequestDetailViewModel`,
 * `StatsViewModel`. `TraceWaterfall` and `JsonViewer` have no view-model —
 * both are pure, props-driven renderers with no ownable business state.
 * `useDiffPair`, `useCommandPaletteState`, `useTourState`, and
 * `useDragPosition` stay Inspector-shell-only per the ADR.
 */
export type { ViewModel } from './contract'

export {
  createFilterViewModel,
  CONTENT_TYPES,
  SORT_COMBOS,
  GROUP_OPTIONS,
  RUNTIMES,
  STATUS_CHIPS,
  type FilterViewModel,
  type FilterState,
  type FilterIntents,
  type StatusChip,
} from './FilterViewModel'

export {
  createSelectionViewModel,
  type SelectionViewModel,
  type SelectionState,
  type SelectionIntents,
} from './SelectionViewModel'

export {
  createRequestListViewModel,
  type RequestListViewModel,
  type RequestListState,
  type RequestListIntents,
  type RequestListViewModelOptions,
} from './RequestListViewModel'

export {
  createRequestDetailViewModel,
  type RequestDetailViewModel,
  type RequestDetailState,
  type RequestDetailIntents,
  type RequestDetailStore,
  type RequestDetailViewModelOptions,
} from './RequestDetailViewModel'

export {
  createStatsViewModel,
  type StatsViewModel,
  type StatsState,
  type StatsIntents,
  type StatsStore,
  type DurationStats,
  type StatusClassBucket,
  type MethodBucket,
} from './StatsViewModel'
