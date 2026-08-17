/**
 * StatsViewModel — UI-state slice behind `Stats.tsx`'s domain filter row:
 * just `selectedDomain` and `showAllUrls`. Narrower than the web twin (ADR
 * 0003) because RN's `Stats.tsx` receives `logs` + a pre-computed
 * `MonitorSummary` as props from `HakkaInspector.tsx`'s one live subscription
 * — re-subscribing here would duplicate it, not share it. `logs`-derived
 * aggregations stay component-level `useMemo`s over this snapshot + `logs`.
 */
import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

export interface StatsState {
  selectedDomain: string | null
  showAllUrls: boolean
}

export interface StatsIntents {
  /** Select a domain chip, or clear the filter by passing the already-selected domain again (matches the original `setSelectedDomain(isSelected ? null : item.id)`). */
  selectDomain(domain: string | null): void
  toggleShowAllUrls(): void
}

export type StatsViewModel = ViewModel<StatsState, StatsIntents>

export function createStatsViewModel(): StatsViewModel {
  const emitter = createEmitter()
  let selectedDomain: string | null = null
  let showAllUrls = false

  // useSyncExternalStore compares snapshot IDENTITY after every render — a
  // fresh object per getSnapshot() call loops React into "Maximum update
  // depth exceeded". Cache the snapshot; invalidate only when state mutates.
  let snapshot: StatsState | null = null
  const commit = () => {
    snapshot = null
    emitter.notify()
  }

  const intents: StatsIntents = {
    selectDomain(domain) {
      selectedDomain = selectedDomain === domain ? null : domain
      commit()
    },
    toggleShowAllUrls() {
      showAllUrls = !showAllUrls
      commit()
    },
  }

  return {
    getSnapshot: () => (snapshot ??= { selectedDomain, showAllUrls }),
    subscribe: emitter.subscribe,
    intents,
  }
}
