/**
 * SelectionViewModel — multi-select slice behind `HakkaInspector.tsx`'s
 * bulk-action bar. RN twin of the web `SelectionViewModel.ts` (ADR 0003):
 * platform-neutral, close to a literal port (same state, intents, semantics),
 * duplicated rather than imported since `hakka-react-native` can't import
 * from `packages/hakka-browser`.
 *
 * Selecting a request auto-enters select mode on the FIRST selection only;
 * cancelling select mode clears the set.
 */
import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

export interface SelectionState {
  selectMode: boolean
  selectedIds: Set<string>
}

export interface SelectionIntents {
  setSelectMode(v: boolean): void
  /** Flip `selectMode`. Clears the selection when turning select mode off, same as `setSelectMode(false)`. */
  toggleSelectMode(): void
  toggleSelectId(id: string): void
  /** Remove one id from the selection without affecting select mode. */
  removeId(id: string): void
  /** Empty the selection WITHOUT touching select mode. */
  clearIds(): void
  /** Reset both selectMode and the selection — matches `handleCancelSelect`. */
  clear(): void
}

export type SelectionViewModel = ViewModel<SelectionState, SelectionIntents>

export function createSelectionViewModel(): SelectionViewModel {
  const emitter = createEmitter()
  let selectMode = false
  let selectedIds = new Set<string>()

  // Snapshot identity must stay stable between mutations — see
  // StatsViewModel.ts's note on useSyncExternalStore's identity comparison.
  let snapshot: SelectionState | null = null
  const commit = () => {
    snapshot = null
    emitter.notify()
  }

  const intents: SelectionIntents = {
    setSelectMode(v) {
      selectMode = v
      if (!v) selectedIds = new Set<string>()
      commit()
    },
    toggleSelectMode() {
      intents.setSelectMode(!selectMode)
    },
    toggleSelectId(id) {
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selectedIds = next
      // Enter select mode on first selection only — matches
      // HakkaInspector.tsx's handleToggleSelect (never on a deselect that
      // empties the set while select mode is already off).
      if (!selectMode && next.size > 0) selectMode = true
      commit()
    },
    removeId(id) {
      if (!selectedIds.has(id)) return
      const next = new Set(selectedIds)
      next.delete(id)
      selectedIds = next
      commit()
    },
    clearIds() {
      selectedIds = new Set<string>()
      commit()
    },
    clear() {
      selectMode = false
      selectedIds = new Set<string>()
      commit()
    },
  }

  return {
    getSnapshot: () => (snapshot ??= { selectMode, selectedIds }),
    subscribe: emitter.subscribe,
    intents,
  }
}
