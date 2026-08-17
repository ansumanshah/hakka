/**
 * Headless view-model layer for hakka-react-native — RN twin of
 * `packages/hakka-browser/src/ui/viewModels/` (see ADR 0003). See `contract.ts` for the
 * shared `{ getSnapshot, subscribe, intents }` shape every view-model below
 * implements, consumed via `useSyncExternalStore` from the RN screens.
 *
 * `FilterViewModel`: `HakkaInspector.tsx`'s Network-tab filter/sort/group/domain
 * state. `SelectionViewModel`: multi-select bulk-action state, shared verbatim
 * in shape with the web twin. `StatsViewModel`: `Stats.tsx`'s domain-selection
 * UI state (the pure `logs`-derived aggregations stay component-level `useMemo`s).
 */
export type { ViewModel } from './contract'

export {
  createFilterViewModel,
  type FilterViewModel,
  type FilterState,
  type FilterIntents,
  type StatusGroup,
} from './FilterViewModel'

export {
  createSelectionViewModel,
  type SelectionViewModel,
  type SelectionState,
  type SelectionIntents,
} from './SelectionViewModel'

export { createStatsViewModel, type StatsViewModel, type StatsState, type StatsIntents } from './StatsViewModel'

export {
  createSettingsViewModel,
  DEFAULT_DESKTOP_URL,
  RETENTION_OPTIONS,
  type SettingsViewModel,
  type SettingsState,
  type SettingsIntents,
  type ImportSessionResult,
  type InfoRow,
  type InfoSection,
} from './SettingsViewModel'
