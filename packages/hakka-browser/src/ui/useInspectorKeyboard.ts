// Global keyboard shortcuts — Cmd/Ctrl-K works even when the inspector is
// closed (opens + summons it). Everything else only fires while the panel is
// open, no palette/modal is blocking, and the user isn't typing in an
// input/textarea/contenteditable. A factory (not a component) called once
// from Inspector's render body, same pattern as the view-model factories in
// ./viewModels — Solid tracks the calling component as the owner regardless
// of which file the factory function is defined in, so `onSettled`'s window
// listener + cleanup register correctly here.
import type { NetworkRequest } from 'hakka-core'
import { onSettled } from 'solid-js'

const isTypingTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export interface InspectorKeyboardDeps {
  open: () => boolean
  setOpen: (v: boolean) => void
  paletteOpen: () => boolean
  setPaletteOpen: (v: boolean | ((v: boolean) => boolean)) => void
  diffPair: () => unknown
  closeCompare: () => void
  selected: () => NetworkRequest | null
  setSelected: (req: NetworkRequest | null) => void
  tab: () => string
  getFilteredList: () => NetworkRequest[]
  searchInputEl: () => HTMLInputElement | null
}

export function useInspectorKeyboard(deps: InspectorKeyboardDeps): void {
  const moveSelection = (delta: number) => {
    const list = deps.getFilteredList()
    if (list.length === 0) return
    const cur = deps.selected()
    const idx = cur ? list.findIndex((r) => r.id === cur.id) : -1
    const next = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, idx + delta))
    deps.setSelected(list[next] ?? null)
  }

  const onGlobalKeyDown = (e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey
    // Cmd/Ctrl-K opens the palette from anywhere (and opens the panel if closed).
    if (isMod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      if (!deps.open()) deps.setOpen(true)
      deps.setPaletteOpen((v) => !v)
      return
    }
    if (deps.paletteOpen()) return // CommandPalette owns its own keys while open
    if (!deps.open()) return
    if (e.key === 'Escape') {
      if (deps.diffPair()) {
        e.preventDefault()
        deps.closeCompare()
      } else if (deps.selected()) {
        e.preventDefault()
        deps.setSelected(null)
      }
      return
    }
    if (isTypingTarget(e.target)) return
    if (e.key === '/') {
      e.preventDefault()
      deps.searchInputEl()?.focus()
    } else if (deps.tab() === 'network' && (e.key === 'j' || e.key === 'k') && !e.altKey) {
      e.preventDefault()
      moveSelection(e.key === 'j' ? 1 : -1)
    } else if (e.key === 'Enter' && deps.tab() === 'network' && deps.selected() === null) {
      const list = deps.getFilteredList()
      if (list.length > 0) deps.setSelected(list[0]!)
    }
  }

  onSettled(() => {
    // Listen on window, not the Shadow DOM root — keydown is composed and
    // bubbles across the shadow boundary regardless, so this works even when
    // focus is on the host page.
    window.addEventListener('keydown', onGlobalKeyDown)
    return () => window.removeEventListener('keydown', onGlobalKeyDown)
  })
}
