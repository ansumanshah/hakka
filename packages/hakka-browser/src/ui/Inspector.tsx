import type { NetworkRequest } from 'hakka-core'
import { Hakka } from 'hakka-core'
import type { Component } from 'solid-js'
import { createEffect, createMemo, createSignal, onSettled, Show } from 'solid-js'

import { store } from '../worker'
import { createInspectorPaletteActions } from './createInspectorPaletteActions'
import { createInspectorExportActions, withFullBodies } from './inspectorExports'
import { InspectorNetworkPane } from './InspectorNetworkPane'
import { InspectorOverlays } from './InspectorOverlays'
import { InspectorPluginPanels } from './InspectorPluginPanels'
import { InspectorResizeHandle } from './InspectorResizeHandle'
import { InspectorToggleButton } from './InspectorToggleButton'
import { InspectorToolbar } from './InspectorToolbar'
import { loadUiState, saveUiState } from './persist'
import { STYLES } from './styles'
import type { TourStep } from './Tour'
import { useInspectorKeyboard } from './useInspectorKeyboard'
import { useInspectorShellEffects, sharedStylesSheet } from './useInspectorShellEffects'
import { createFilterViewModel, createRequestListViewModel, createSelectionViewModel } from './viewModels'

// Register built-in panels via the plugin system — Hakka.use() is idempotent
// for the same id, so this is safe to run once at module load.
Hakka.use({
  id: 'hakka-browser-builtin',
  panels: [
    { id: 'network', title: 'Network', order: 0 },
    { id: 'stats', title: 'Stats', order: 1 },
    { id: 'rules', title: 'Rules', order: 2 },
    { id: 'console', title: 'Logs', order: 3 },
    { id: 'storage', title: 'Storage', order: 4 },
    { id: 'settings', title: 'Settings', order: 5 },
  ],
})

// Panel ids that used to be top-level tabs — map a persisted selection from an
// older session onto the tab that absorbed them.
const LEGACY_TAB_IDS: Record<string, string> = {
  mock: 'rules',
  breakpoints: 'rules',
  throttle: 'rules',
  info: 'settings',
}

// Panel tab type is dynamic — derived from Hakka.getPanels() panel ids.
type MainTab = string

/** Imperative handle handed to `props.onReady` once — the embed API's (`mount.tsx`) only way to drive tabs from outside. */
export interface InspectorApi {
  /** Switch the active panel/tab (e.g. 'network', 'console', 'settings'). No-op for an unknown id. */
  setTab: (id: string) => void
}

export interface InspectorProps {
  /**
   * Render inline, filling the container Inspector was mounted into, instead
   * of the floating overlay: no toggle button, no fixed positioning, no close
   * button (nothing to "close" — the caller controls lifetime via `mount()`'s
   * returned handle). Same component tree as floating mode otherwise. Set by
   * `mount.tsx`; the floating overlay (`register.ts`) never sets this.
   */
  embedded?: boolean
  /** Initial panel id when embedded (e.g. 'network', 'console'). Falls back to the persisted/default tab if omitted or unknown. */
  initialTab?: string
  /** Called once after mount with an imperative handle. Embedded mode's only use for this today is `setTab`. */
  onReady?: (api: InspectorApi) => void
}

export const Inspector: Component<InspectorProps> = (props) => {
  const embedded = () => props.embedded ?? false

  const panels = Hakka.getPanels()
  const defaultTab = panels[0]?.id ?? 'network'

  const saved = loadUiState()

  const [open, setOpenRaw] = createSignal(saved.open)
  const savedTab = LEGACY_TAB_IDS[saved.tab] ?? saved.tab
  const initialTabId = props.initialTab && panels.some((p) => p.id === props.initialTab) ? props.initialTab : undefined
  const [tab, setTabRaw] = createSignal<MainTab>(
    initialTabId ?? panels.find((p) => p.id === savedTab)?.id ?? defaultTab,
  )

  // Toggle button position — raw px from viewport left/top, clamped on read
  // (not write) so no viewport-resize listener is needed.
  const [btnX, setBtnX] = createSignal(saved.bx >= 0 ? saved.bx : -1) // -1 = use CSS default (right:20 bottom:20)
  const [btnY, setBtnY] = createSignal(saved.by >= 0 ? saved.by : -1)

  // Compact inline HUD — a third state alongside collapsed/open, never
  // persisted. Declared above setOpen so opening the panel via any path
  // collapses it; panel and HUD are mutually exclusive.
  const [hudOpen, setHudOpen] = createSignal(false)

  // Mobile full-height escalation (< 680px only), toggled via .hakka-mobile-grip
  // (.mobile-full in styles.ts). Never persisted — resets to the 60dvh partial
  // default on every open, per MOBILE-LAYOUT-SPEC.md §0/§2.
  const [mobileFull, setMobileFull] = createSignal(false)

  const setOpen = (v: boolean) => {
    setOpenRaw(v)
    saveUiState({ open: v })
    if (v) setHudOpen(false)
    else setMobileFull(false)
  }

  const setTab = (t: MainTab) => {
    setTabRaw(t)
    saveUiState({ tab: t })
  }

  // ── View-models (ADR 0003) ───────────────────────────────────────────────────
  // Each view-model is wrapped in a Solid signal, refreshed on `subscribe`, so
  // the rest of this component reads them like the local signals they replaced.
  const filters = createFilterViewModel()
  const [filterSnap, setFilterSnap] = createSignal(filters.getSnapshot())
  onSettled(() => {
    const off = filters.subscribe(() => setFilterSnap(filters.getSnapshot()))
    // onSettled fires later than 1.x onMount, so resync here or miss anything
    // the view-model emitted before settle.
    setFilterSnap(filters.getSnapshot())
    return off
  })

  const selection = createSelectionViewModel()
  const [selectionSnap, setSelectionSnap] = createSignal(selection.getSnapshot())
  onSettled(() => {
    const off = selection.subscribe(() => setSelectionSnap(selection.getSnapshot()))
    setSelectionSnap(selection.getSnapshot())
    return off
  })

  const requestListVm = createRequestListViewModel({ store: store(), filters })
  const [listSnap, setListSnap] = createSignal(requestListVm.getSnapshot())
  onSettled(() => {
    const off = requestListVm.subscribe(() => setListSnap(requestListVm.getSnapshot()))
    setListSnap(requestListVm.getSnapshot())
    return () => {
      off()
      requestListVm.destroy()
    }
  })
  // Memoized per-field: listSnap is written from outside any Solid
  // computation (the view-model's subscribe callback), so each memo shares
  // one dependency instead of every read site re-deriving it from listSnap().
  const requestCount = createMemo(() => listSnap().count)
  const requestLogs = createMemo(() => listSnap().logs)
  const filteredRequests = createMemo(() => listSnap().filtered)
  const requestGroups = createMemo(() => listSnap().groups)
  const searchSuggestionsSnap = createMemo(() => listSnap().searchSuggestions)
  const hasServerCapturesSnap = createMemo(() => listSnap().hasServerCaptures)
  const isFilteredSnap = createMemo(() => listSnap().isFiltered)
  const spansByTraceSnap = createMemo(() => listSnap().spansByTrace)

  const [selected, setSelected] = createSignal<NetworkRequest | null>(null)
  // Wide viewports keep the request list visible next to the detail pane
  // (split view); narrow viewports swap list ↔ detail like a drill-down.
  const wideQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 900px)')
      : null
  const [isWide, setIsWide] = createSignal(wideQuery?.matches ?? false)
  if (wideQuery) {
    onSettled(() => {
      const onWideChange = (e: MediaQueryListEvent) => setIsWide(e.matches)
      wideQuery.addEventListener?.('change', onWideChange)
      // Re-read after subscribing — a resize during the render→settle gap
      // would otherwise leave isWide stale until the next change event.
      setIsWide(wideQuery.matches)
      return () => wideQuery.removeEventListener?.('change', onWideChange)
    })
  }

  // Keep an open Detail live: a selected request's later emits (status/body,
  // a growing SSE stream) replace its record in the list mirror — without this,
  // Detail would keep rendering the click-time snapshot forever. Reference-equal
  // no-op when nothing changed, so unrelated filter updates don't re-render it.
  createEffect(
    () => {
      const sel = selected()
      if (!sel) return null
      const fresh = listSnap().logs.find((r) => r.id === sel.id)
      return fresh && fresh !== sel ? fresh : null
    },
    (fresh) => {
      if (fresh) setSelected(fresh)
    },
  )

  // ── Compact density (persisted) — shell display preference, not part of
  // any view-model, parallel to panel height/opacity in presets.ts. ──
  const [compact, setCompactRaw] = createSignal(saved.compactDensity)
  const setCompact = (v: boolean) => {
    setCompactRaw(v)
    saveUiState({ compactDensity: v })
  }

  // Request-kind filter — client-side-only predicate over trace groups'
  // root-span requestKind (see FilterBar.tsx). NOT persisted, NOT part of
  // FilterViewModel: `compileQuery` doesn't model spans in v1.
  const [requestKindFilter, setRequestKindFilter] = createSignal('all')

  const selectedRequests = createMemo<NetworkRequest[]>(() => {
    const ids = selectionSnap().selectedIds
    return listSnap().logs.filter((r) => ids.has(r.id))
  })

  // ── Exports/session (Export + Session menus, InspectorToolbar/InspectorNetworkPane) ──
  let sessionFileInput: HTMLInputElement | undefined
  const triggerLoadSession = () => sessionFileInput?.click()
  const exportActions = createInspectorExportActions({
    getSelected: selectedRequests,
    getFiltered: () => listSnap().filtered,
    importRequests: requestListVm.intents.importRequests,
  })

  // ── Request diff (compare exactly two selected requests) ───────────────────
  const [diffPair, setDiffPair] = createSignal<[NetworkRequest, NetworkRequest] | null>(null)
  const canCompare = () => selectedRequests().length === 2
  const openCompare = () => {
    const reqs = selectedRequests()
    if (reqs.length !== 2) return
    const pair: [NetworkRequest, NetworkRequest] = [reqs[0]!, reqs[1]!]
    // Show the diff immediately; bodies fill in once the RPC resolves.
    // Guarded by id so a stale fetch (compare closed or pair changed) never applies.
    setDiffPair(pair)
    void withFullBodies(pair).then(([left, right]) => {
      const current = diffPair()
      if (current && current[0].id === pair[0].id && current[1].id === pair[1].id) {
        setDiffPair([left!, right!])
      }
    })
  }
  const closeCompare = () => setDiffPair(null)

  // ── Command palette (Cmd/Ctrl-K) ────────────────────────────────────────────
  const [paletteOpen, setPaletteOpen] = createSignal(false)

  // ── Tour (opt-in) ───────────────────────────────────────────────────────────
  // Points at the search box, tab strip, and ⌘K button. Launched ONLY from the
  // command palette, never auto-opened: `tourSeen` lives in localStorage, so a
  // fresh profile/incognito pane would re-trigger it every time — reads as
  // nagging, and the empty state already teaches the first step.
  const [tourActive, setTourActive] = createSignal(false)
  let panelRootEl: HTMLDivElement | undefined
  const TOUR_STEPS: TourStep[] = [
    {
      selector: '.hakka-search',
      title: 'Search your traffic',
      body: 'Filter by URL, header, status, or duration — try "status:>=400" or "dur>500".',
    },
    {
      selector: '.hakka-tabs',
      title: 'Explore other panels',
      body: 'Logs, Storage, Rules, and Stats live in these tabs alongside Network.',
    },
    {
      selector: '.hakka-btn[title^="Command palette"]',
      title: 'Command palette',
      body: 'Press Cmd/Ctrl-K anytime to jump to a tab or run an action.',
    },
  ]
  const dismissTour = () => {
    setTourActive(false)
    // Recorded for a future subtle-suggestion affordance; nothing reads it today.
    saveUiState({ tourSeen: true })
  }
  // Deferred a tick so the panel's layout has settled and the tour's anchor
  // elements are measurable before the first spotlight positions itself.
  const startTour = () => {
    setTimeout(() => setTourActive(true), 260)
  }

  // Shell-level side effects (stylesheet adoption, theme root registration,
  // embed API handoff, console-error badge count) — see
  // useInspectorShellEffects.ts.
  const { errorCount } = useInspectorShellEffects({
    panelRootEl: () => panelRootEl,
    onReady: props.onReady,
    panels,
    setTab,
  })

  const clearLogs = () => {
    requestListVm.intents.clearLogs()
    setSelected(null)
    // Only the selection SET clears — select mode itself stays on, reachable
    // via the command palette's "Clear captured requests" even mid-select.
    selection.intents.clearIds()
  }

  // ── Command palette actions — see createInspectorPaletteActions.ts ─────────
  const paletteActions = createInspectorPaletteActions({
    panels,
    tab,
    setTab,
    clearLogs,
    compact,
    setCompact,
    selection,
    selectionSnap,
    filters,
    filterSnap,
    canCompare,
    openCompare,
    startTour,
    exportActions,
    triggerLoadSession,
  })

  let searchInputEl: HTMLInputElement | null = null
  useInspectorKeyboard({
    open,
    setOpen,
    paletteOpen,
    setPaletteOpen,
    diffPair,
    closeCompare,
    selected,
    setSelected,
    tab,
    getFilteredList: () => listSnap().filtered,
    searchInputEl: () => searchInputEl,
  })

  return (
    <>
      {/* Inline style only where Constructable Stylesheets are unavailable —
          otherwise the shared sheet is adopted in onSettled below, so the CSS
          string parses once per page, not once per mount. */}
      <Show when={!sharedStylesSheet()}>
        <style>{STYLES}</style>
      </Show>

      <InspectorToggleButton
        embedded={embedded}
        open={open}
        hudOpen={hudOpen}
        setHudOpen={setHudOpen}
        setOpen={setOpen}
        btnX={btnX}
        setBtnX={setBtnX}
        btnY={btnY}
        setBtnY={setBtnY}
        requestCount={requestCount}
        requestLogs={requestLogs}
      />

      <div
        class={`hakka-panel${embedded() ? ' embedded' : open() ? ' open' : ''}${
          !embedded() && mobileFull() ? ' mobile-full' : ''
        }`}
        ref={(el) => (panelRootEl = el)}
      >
        <InspectorResizeHandle
          embedded={embedded}
          mobileFull={mobileFull}
          setMobileFull={setMobileFull}
          panelRootEl={() => panelRootEl}
          initialHeightPx={saved.panelHeightPx}
        />

        <InspectorToolbar
          panels={panels}
          tab={tab}
          setTab={setTab}
          errorCount={errorCount}
          requestCount={requestCount}
          embedded={embedded}
          selectMode={() => selectionSnap().selectMode}
          clearLogs={clearLogs}
          exportActions={exportActions}
          setPaletteOpen={setPaletteOpen}
          setOpen={setOpen}
          sessionFileInputRef={(el) => (sessionFileInput = el)}
          onTriggerLoadSession={triggerLoadSession}
        />

        {/* Tab content — network panel. List and detail render side-by-side on
            wide viewports; narrow viewports drill down (list ↔ detail swap). */}
        <Show when={tab() === 'network'}>
          <InspectorNetworkPane
            filters={filters}
            filterSnap={filterSnap}
            selection={selection}
            selectionSnap={selectionSnap}
            requestListVm={requestListVm}
            searchSuggestions={searchSuggestionsSnap}
            hasServerCaptures={hasServerCapturesSnap}
            compact={compact}
            onToggleCompact={() => setCompact(!compact())}
            searchInputRef={(el) => (searchInputEl = el)}
            requestKindFilter={requestKindFilter}
            onRequestKindFilterChange={setRequestKindFilter}
            isFiltered={isFilteredSnap}
            filteredRequests={filteredRequests}
            requestCount={requestCount}
            requestGroups={requestGroups}
            spansByTrace={spansByTraceSnap}
            selected={selected}
            onSelect={setSelected}
            isWide={isWide}
            canCompare={canCompare}
            onOpenCompare={openCompare}
            bulkExportHar={exportActions.bulkExportHar}
            bulkCopyCurl={exportActions.bulkCopyCurl}
            bulkExportPostman={exportActions.bulkExportPostman}
            bulkExportOtel={exportActions.bulkExportOtel}
          />
        </Show>

        <InspectorPluginPanels panels={panels} tab={tab} diffPair={diffPair} onCloseCompare={closeCompare} />
      </div>

      <InspectorOverlays
        paletteOpen={paletteOpen}
        paletteActions={paletteActions}
        onClosePalette={() => setPaletteOpen(false)}
        tourActive={tourActive}
        open={open}
        panelRootEl={() => panelRootEl}
        tourSteps={TOUR_STEPS}
        onTourDone={dismissTour}
      />
    </>
  )
}
