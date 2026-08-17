/**
 * `<hakka-request-list>` — ADR 0003 (b)/(c). Wraps `../RequestList.tsx`
 * (unmodified — "shared source, separate build") with a
 * `RequestListViewModel` of its own plus the shared `FilterViewModel`/
 * `SelectionViewModel` singletons from `./shared.ts`, so a lone
 * `<hakka-request-list>` behaves like the Network tab inside the full
 * `<hakka-inspector>` overlay — same windowing, filter engine, and
 * multi-select — without the tab shell or worker bootstrap around it.
 *
 * Attributes: `compact` (bool), `select-mode` (bool), `group-by` (enum:
 * none|host|status|method|error|trace), `trace-view` (bool), `verbose-spans`
 * (bool — initial value for the span-verbosity toggle).
 * Properties: `store` (injected `StoreClient`-shaped object), `viewModel`
 * (a full `RequestListViewModel` — bypasses `store`/the shared
 * `FilterViewModel` entirely; a desktop host's tree-data adapter is exactly
 * this case per ADR 0003's Context section), `spansByTrace` (overrides the
 * view-model's own live span feed — usually left unset).
 * Events: `hakka:select` (`detail: { id: string }`).
 *
 * `select-mode`/`group-by` back the SHARED `SelectionViewModel`/
 * `FilterViewModel` singletons, so they are seeded ONCE at connect rather
 * than continuously re-applied — a continuous sync would let whichever
 * instance mounts LAST stomp every earlier instance's live shared state
 * back to its own default. Seeding once gives the common
 * single-instance-per-page case the "start already in this state" behavior
 * ADR 0003 (b) describes, without that failure mode for the multi-instance
 * case. `compact`/`trace-view` have no shared-state backing, so they stay
 * fully reactive as ordinary Solid prop reads.
 *
 * SSR: `../RequestList` (and transitively `../RequestRow`, …) is a compiled
 * Solid JSX module — `@solidjs/vite-plugin`'s compiler emits module-scope
 * `_$template()` calls that touch `document` the instant the module is
 * evaluated, not when a component renders. A plain top-level
 * import here would crash under bare Node/SSR ("document is not defined").
 *
 * Fixed with `lazy()` + `<Loading>` (the same mechanism `RequestList.tsx`
 * uses for `TraceWaterfall`, `Inspector.tsx` for
 * `CommandPalette`/`RequestDiff`/`Tour`) instead of a bare dynamic
 * `import()`: `lazy()` doesn't call `import()` until Solid actually
 * attempts to render the lazy component inside a real, connected element —
 * which never happens in Node. This keeps `register()` itself synchronous,
 * so a property set right after `register()` (e.g. `el.store = store`) is
 * wired up the same tick, with no async-upgrade race to lose it across.
 * `TAG` is re-exported from `./tags` — zero Solid imports — so a consumer
 * that only needs the tag name never pulls in solid-js/@solidjs/element.
 */
import { customElement } from '@solidjs/element'
import type { FrameworkSpan, GroupBy } from 'hakka-core'
import { createEffect, createMemo, createSignal, lazy, Loading, onSettled } from 'solid-js'

import { createRequestListViewModel } from '../viewModels'
import type { RequestListViewModel } from '../viewModels'
import {
  adoptSharedStyles,
  asHakkaElement,
  canRegisterElements,
  fireHakkaEvent,
  isRegistered,
  registerThemeRoot,
  sharedFilterViewModel,
  sharedSelectionViewModel,
  sharedStore,
} from './shared'
import type { StoreClient } from './shared'
import { REQUEST_LIST_TAG } from './tags'

export const TAG = REQUEST_LIST_TAG

// See the file doc comment's SSR note — evaluating this line never calls
// import() itself; that's deferred to first render.
const LazyRequestList = lazy(() => import('../RequestList').then((m) => ({ default: m.RequestList })))

interface RequestListElementProps {
  compact: boolean
  selectMode: boolean
  groupBy: GroupBy
  traceView: boolean
  /** Initial value for the verbose-spans toggle — per-instance render
   * state, no shared-state backing (same category as `compact`/`traceView`). */
  verboseSpans: boolean
  store: StoreClient | null
  viewModel: RequestListViewModel | null
  /** Overrides the view-model's own live `spansByTrace`. Usually left
   * unset; the view-model already tracks this from the store's span feed. */
  spansByTrace: ReadonlyMap<string, FrameworkSpan[]> | null
}

function isFullViewModel(v: unknown): v is RequestListViewModel {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as RequestListViewModel).getSnapshot === 'function' &&
    typeof (v as RequestListViewModel).subscribe === 'function' &&
    typeof (v as RequestListViewModel).intents === 'object'
  )
}

/** Idempotent — safe to call more than once (a no-op after the first, and a
 * no-op — not a throw — anywhere `customElements` doesn't exist). */
export function register(): void {
  if (!canRegisterElements() || isRegistered(TAG)) return
  customElement(
    TAG,
    {
      compact: false,
      selectMode: false,
      groupBy: 'none' as GroupBy,
      traceView: false,
      verboseSpans: false,
      // Object properties must be declared (null default is fine) — an
      // undeclared object prop silently stringifies to "[object Object]" in
      // a React host.
      store: null as StoreClient | null,
      viewModel: null as RequestListViewModel | null,
      spansByTrace: null as ReadonlyMap<string, FrameworkSpan[]> | null,
    },
    (props: RequestListElementProps, { element: rawElement }) => {
      const element = asHakkaElement(rawElement)
      adoptSharedStyles(element.renderRoot)
      onSettled(() => registerThemeRoot(element))

      const selection = sharedSelectionViewModel()
      const filters = sharedFilterViewModel()

      const injectedVm = createMemo(() => (isFullViewModel(props.viewModel) ? props.viewModel : null))

      // The view-model this instance owns (torn down on cleanup) vs. an
      // injected one (owned — and destroyed — by whoever constructed it,
      // same discipline `Detail.tsx`/`StatsTab.tsx` apply to their own).
      let ownVm: RequestListViewModel | null = null
      const vm = createMemo<RequestListViewModel>(() => {
        const injected = injectedVm()
        if (injected) return injected
        ownVm ??= createRequestListViewModel({ store: props.store ?? sharedStore(), filters })
        return ownVm
      })

      const [snap, setSnap] = createSignal(vm().getSnapshot())
      createEffect(
        () => vm(),
        (current) => {
          setSnap(current.getSnapshot())
          return current.subscribe(() => setSnap(current.getSnapshot()))
        },
      )
      onSettled(() => () => ownVm?.destroy())

      const [selSnap, setSelSnap] = createSignal(selection.getSnapshot())
      onSettled(() => {
        const unsub = selection.subscribe(() => setSelSnap(selection.getSnapshot()))
        // onSettled runs later than 1.x onMount — re-pull immediately so a
        // mutation between first render and settle isn't missed.
        setSelSnap(selection.getSnapshot())
        return unsub
      })

      // Per-instance render state, seeded from the initial attribute value.
      const [verboseSpans, setVerboseSpans] = createSignal(props.verboseSpans)

      // Currently "active" (last hakka:select'd) row — ephemeral render
      // state, not a view-model concern (mirrors Detail.tsx's own local tab/
      // copied signals). Looked up against the unfiltered mirror so the
      // highlight survives a filter narrowing the visible set.
      const [activeId, setActiveId] = createSignal<string | null>(null)
      const activeReq = createMemo(() => snap().logs.find((r) => r.id === activeId()) ?? null)

      // Seed-once: see the file doc comment for why this isn't a continuous
      // sync.
      onSettled(() => {
        if (props.selectMode) selection.intents.setSelectMode(true)
        if (props.groupBy && props.groupBy !== 'none' && !injectedVm()) {
          filters.intents.setGroupBy(props.groupBy)
        }
      })

      return (
        <Loading fallback={null}>
          <LazyRequestList
            requests={snap().filtered}
            groups={snap().groups}
            traceView={props.traceView}
            selected={activeReq()}
            onSelect={(req) => {
              setActiveId(req.id)
              fireHakkaEvent(element, 'hakka:select', { id: req.id })
            }}
            selectMode={selSnap().selectMode}
            selectedIds={selSnap().selectedIds}
            onToggleSelect={(id) => selection.intents.toggleSelectId(id)}
            compact={props.compact}
            onLoadSample={() => void vm().intents.loadSampleTraffic()}
            spansByTrace={props.spansByTrace ?? snap().spansByTrace}
            verboseSpans={verboseSpans()}
            onToggleVerboseSpans={() => setVerboseSpans((v) => !v)}
          />
        </Loading>
      )
    },
  )
}
