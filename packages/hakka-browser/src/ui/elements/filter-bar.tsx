/**
 * `<hakka-filter-bar>` — ADR 0003 (b)/(c). Wraps `../FilterBar.tsx`
 * unmodified.
 *
 * Attributes: `nl-mode` (bool), `advanced-open` (bool) — back the shared
 * `FilterViewModel` singleton's toggle-only intents, seeded once at connect
 * rather than continuously re-applied (see `request-list.tsx`'s doc comment
 * for the full reasoning — identical here).
 * Properties: `store` (optional, ranks hosts for search-box suggestions
 * only — see below), `viewModel` (a full `FilterViewModel`, bypasses the
 * shared singleton entirely).
 * Events: `hakka:filter-change` (`detail`: the full `SavedFilter` shape) —
 * fired alongside mutating the shared `FilterViewModel`, so a host with its
 * own injected `viewModel` can still react without polling.
 *
 * `createFilterViewModel()` has no store dependency — filter/sort/group
 * state is pure UI state persisted to `localStorage`. `store` instead ranks
 * captured hosts for the search box's autocomplete (`FilterBar.tsx`'s
 * `suggestions` prop); `RequestListViewModel`'s private
 * `computeSearchSuggestions` isn't exported, so that logic is
 * re-implemented here in miniature (`computeSuggestions` below).
 *
 * `hasServerCaptures` (gates the Runtime segmented control) has no
 * standalone equivalent, so it defaults to `false` unless a `store` is
 * injected. `compact`/`onToggleCompact` is local, ephemeral UI state (no
 * view-model owns "compact", even inside `Inspector.tsx`).
 * `selectMode`/`onToggleSelectMode` DO have shared backing
 * (`SelectionViewModel`), wired to the same singleton `request-list.tsx`
 * reads.
 *
 * SSR: `../FilterBar` is a compiled Solid JSX module — see
 * `request-list.tsx`'s doc comment for why this uses `lazy()` + `<Loading>`
 * rather than a bare dynamic `import()`. `TAG` is re-exported from
 * `./tags` (zero Solid imports).
 */
import { customElement } from '@solidjs/element'
import { createEffect, createMemo, createSignal, lazy, Loading, onSettled } from 'solid-js'

import type { SavedFilter } from '../persist'
import type { FilterState, FilterViewModel } from '../viewModels'
import {
  adoptSharedStyles,
  asHakkaElement,
  canRegisterElements,
  fireHakkaEvent,
  isRegistered,
  registerThemeRoot,
  sharedFilterViewModel,
  sharedSelectionViewModel,
} from './shared'
import type { MinimalStore } from './shared'
import { FILTER_BAR_TAG } from './tags'

export const TAG = FILTER_BAR_TAG

// See the file doc comment's SSR note — evaluating this line never calls
// import() itself; that's deferred to first render.
const LazyFilterBar = lazy(() => import('../FilterBar').then((m) => ({ default: m.FilterBar })))

interface FilterBarElementProps {
  nlMode: boolean
  advancedOpen: boolean
  store: MinimalStore | null
  viewModel: FilterViewModel | null
}

function isFullViewModel(v: unknown): v is FilterViewModel {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as FilterViewModel).getSnapshot === 'function' &&
    typeof (v as FilterViewModel).subscribe === 'function'
  )
}

/** Mirrors `RequestListViewModel`'s private `SCOPE_HINTS` — that list isn't
 * exported, so it's intentionally re-declared here rather than forking the
 * file it lives in for one array literal. Keep in sync by hand if either
 * changes. */
const SCOPE_HINTS = ['host:', 'header:', 'body:', 'status:', 'method:', 'dur>', 'size<']

function toSavedFilter(s: FilterState): SavedFilter {
  return {
    filterText: s.filterText,
    filterMethod: s.methodFilter,
    filterStatus: s.statusChip,
    filterContentType: s.contentType,
    filterRuntime: s.runtimeFilter,
    sortField: s.sortField,
    sortOrder: s.sortOrder,
    groupBy: s.groupBy,
    durMin: s.durMin,
    durMax: s.durMax,
    sizeMinKb: s.sizeMinKb,
    sizeMaxKb: s.sizeMaxKb,
  }
}

/** Idempotent — safe to call more than once (a no-op after the first, and a
 * no-op — not a throw — anywhere `customElements` doesn't exist). */
export function register(): void {
  if (!canRegisterElements() || isRegistered(TAG)) return
  customElement(
    TAG,
    {
      nlMode: false,
      advancedOpen: false,
      // Object properties must be declared (null default is fine) — an
      // undeclared object prop silently stringifies to "[object Object]" in
      // a React host.
      store: null as MinimalStore | null,
      viewModel: null as FilterViewModel | null,
    },
    (props: FilterBarElementProps, { element: rawElement }) => {
      const element = asHakkaElement(rawElement)
      adoptSharedStyles(element.renderRoot)
      onSettled(() => registerThemeRoot(element))

      const selection = sharedSelectionViewModel()
      const filters = createMemo<FilterViewModel>(() =>
        isFullViewModel(props.viewModel) ? props.viewModel : sharedFilterViewModel(),
      )

      // Seed-once, synchronously, before the initial snapshot below is
      // taken — see the file doc comment for why this isn't a continuous
      // sync. Deliberately not an `onMount` callback: `<FilterBar>`'s own
      // `createSignal(props.filters.getSnapshot())` reads its initial
      // snapshot the moment it's constructed (synchronously, as part of
      // this function's `return`), and onMount defers until after the
      // initial render commits — too late to guarantee the seed lands
      // first.
      {
        const fvm = filters()
        const initial = fvm.getSnapshot()
        if (props.nlMode && !initial.nlMode) fvm.intents.toggleNlMode()
        if (props.advancedOpen && !initial.advOpen) fvm.intents.toggleAdvanced()
      }

      const [snap, setSnap] = createSignal(filters().getSnapshot())
      createEffect(
        () => filters(),
        (current) => {
          setSnap(current.getSnapshot())
          return current.subscribe(() => {
            const next = current.getSnapshot()
            setSnap(next)
            fireHakkaEvent(element, 'hakka:filter-change', toSavedFilter(next))
          })
        },
      )

      const [selSnap, setSelSnap] = createSignal(selection.getSnapshot())
      onSettled(() => {
        const unsub = selection.subscribe(() => setSelSnap(selection.getSnapshot()))
        // onSettled runs later than 1.x onMount — re-pull immediately so a
        // mutation between first render and settle isn't missed.
        setSelSnap(selection.getSnapshot())
        return unsub
      })

      // Host-ranked suggestions — only computed when a `store` is injected;
      // otherwise falls back to recent filters + the static scope hints.
      const [hosts, setHosts] = createSignal<string[]>([])
      const [hasServerCaptures, setHasServerCaptures] = createSignal(false)
      createEffect(
        () => props.store,
        (client) => {
          if (!client) {
            setHosts([])
            setHasServerCaptures(false)
            return
          }
          const seen = new Set<string>()
          let sawServer = false
          const collect = (req: { url: string; runtime?: string }) => {
            try {
              const host = new URL(req.url).host
              if (host) seen.add(host)
            } catch {
              // malformed URL — skip
            }
            if (req.runtime && req.runtime !== 'client') sawServer = true
          }
          void client.getSnapshot().then((snap) => {
            for (const r of snap) collect(r)
            setHosts([...seen])
            setHasServerCaptures(sawServer)
          })
          return client.subscribe((r) => {
            collect(r)
            setHosts([...seen])
            setHasServerCaptures(sawServer)
          })
        },
      )

      const suggestions = createMemo<string[]>(() => {
        const current = snap().filterDisplay.toLowerCase()
        const results: string[] = []
        for (const rf of snap().recentFilters) {
          if (rf.filterText && !results.includes(rf.filterText)) results.push(rf.filterText)
        }
        for (const host of hosts()) {
          if (!current || host.toLowerCase().includes(current)) {
            const entry = `host:${host}`
            if (!results.includes(entry)) results.push(entry)
          }
        }
        for (const hint of SCOPE_HINTS) {
          if (!current || hint.startsWith(current)) {
            if (!results.includes(hint)) results.push(hint)
          }
        }
        return results.slice(0, 8)
      })

      // Local, ephemeral render toggle — no view-model owns "compact"
      // (see the file doc comment above).
      const [compact, setCompact] = createSignal(false)

      return (
        <Loading fallback={null}>
          <LazyFilterBar
            filters={filters()}
            suggestions={suggestions()}
            hasServerCaptures={hasServerCaptures()}
            compact={compact()}
            onToggleCompact={() => setCompact((c) => !c)}
            selectMode={selSnap().selectMode}
            onToggleSelectMode={() => selection.intents.setSelectMode(!selSnap().selectMode)}
          />
        </Loading>
      )
    },
  )
}
