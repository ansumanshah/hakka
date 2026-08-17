/**
 * SelectionViewModel — the shared multi-select slice named in ADR 0003 (a).
 * Shared by `<hakka-request-list>` (row checkboxes, bulk-action bar) and
 * `<hakka-request-detail>` — deliberately not list-specific, so a second
 * consumer never needs a second, parallel selection concept.
 *
 * Semantics: toggling a row into selection auto-enters select mode on the
 * first selection (not before); turning select mode off clears the set.
 */
import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

export interface SelectionState {
  selectMode: boolean
  selectedIds: ReadonlySet<string>
}

export interface SelectionIntents {
  setSelectMode(v: boolean): void
  toggleSelectId(id: string): void
  /** Remove one id from the selection without affecting select mode (e.g. after a bulk "Remove"). */
  removeId(id: string): void
  /**
   * Empty the selection WITHOUT touching select mode — reachable via the
   * command palette's "Clear captured requests" even while select mode is
   * on, so this must not be the same as `clear()` below.
   */
  clearIds(): void
  /** Reset both selectMode and the selection — used when actually exiting select mode. */
  clear(): void
}

export type SelectionViewModel = ViewModel<SelectionState, SelectionIntents>

export function createSelectionViewModel(): SelectionViewModel {
  const emitter = createEmitter()
  let selectMode = false
  let selectedIds = new Set<string>()

  const intents: SelectionIntents = {
    setSelectMode(v) {
      selectMode = v
      if (!v) selectedIds = new Set<string>()
      emitter.notify()
    },
    toggleSelectId(id) {
      const next = new Set(selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      selectedIds = next
      // Enter select mode on first selection only — never on a deselect that
      // empties the set from an already-off state.
      if (!selectMode && next.size > 0) selectMode = true
      emitter.notify()
    },
    removeId(id) {
      if (!selectedIds.has(id)) return
      const next = new Set(selectedIds)
      next.delete(id)
      selectedIds = next
      emitter.notify()
    },
    clearIds() {
      selectedIds = new Set<string>()
      emitter.notify()
    },
    clear() {
      selectMode = false
      selectedIds = new Set<string>()
      emitter.notify()
    },
  }

  return {
    getSnapshot: () => ({ selectMode, selectedIds }),
    subscribe: emitter.subscribe,
    intents,
  }
}
