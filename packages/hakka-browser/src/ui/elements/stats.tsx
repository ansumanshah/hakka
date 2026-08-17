/**
 * `<hakka-stats>` — ADR 0003 (b)/(c). Wraps `../StatsTab.tsx` unmodified,
 * passing `active={true}` for its `PanelProps` (an Inspector-tab-shell
 * concept this standalone element has no equivalent of — always "active").
 *
 * Attributes: none. Properties: `store` (injected `StoreClient`-shaped
 * object), `viewModel` (a full `StatsViewModel` — bypasses `store` entirely,
 * defaults to the shared singleton's snapshot). Events: none — pure display.
 *
 * No `runtime-filter` attribute: `StatsViewModel` aggregates every captured
 * request unconditionally by design (see its own doc comment) — faking a
 * filter here would mean re-implementing that aggregation with an extra
 * pass duplicated at the element layer.
 *
 * SSR: uses `lazy()` + `<Suspense>`, not a bare `import()` — see
 * `request-list.tsx`'s file doc comment for why.
 */
import { customElement } from '@solidjs/element'
import { createMemo, lazy, onSettled, Loading } from 'solid-js'

import { createStatsViewModel } from '../viewModels'
import type { StatsViewModel } from '../viewModels'
import {
  adoptSharedStyles,
  asHakkaElement,
  canRegisterElements,
  isRegistered,
  registerThemeRoot,
  sharedStore,
} from './shared'
import type { StoreClient } from './shared'
import { STATS_TAG } from './tags'

export const TAG = STATS_TAG

// See the file doc comment's SSR note — evaluating this line never calls
// import() itself; that's deferred to first render.
const LazyStatsTab = lazy(() => import('../StatsTab').then((m) => ({ default: m.StatsTab })))

interface StatsElementProps {
  store: StoreClient | null
  viewModel: StatsViewModel | null
}

function isFullViewModel(v: unknown): v is StatsViewModel {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as StatsViewModel).getSnapshot === 'function' &&
    typeof (v as StatsViewModel).subscribe === 'function'
  )
}

/** Idempotent — safe to call more than once (a no-op after the first, and a
 * no-op — not a throw — anywhere `customElements` doesn't exist). */
export function register(): void {
  if (!canRegisterElements() || isRegistered(TAG)) return
  customElement(
    TAG,
    {
      // Must declare object props (null default is fine) — an undeclared
      // one silently stringifies to "[object Object]" in a React host.
      store: null as StoreClient | null,
      viewModel: null as StatsViewModel | null,
    },
    (props: StatsElementProps, { element: rawElement }) => {
      const element = asHakkaElement(rawElement)
      adoptSharedStyles(element.renderRoot)

      let ownVm: StatsViewModel | null = null
      const vm = createMemo<StatsViewModel>(() => {
        if (isFullViewModel(props.viewModel)) return props.viewModel
        ownVm ??= createStatsViewModel({ store: props.store ?? sharedStore() })
        return ownVm
      })
      onSettled(() => {
        const unregister = registerThemeRoot(element)
        return () => {
          unregister()
          ownVm?.destroy()
        }
      })

      // Passing the resolved `vm()` down means StatsTab never has to know
      // whether it came from injection or this element's own default
      // construction.
      return (
        <Loading fallback={null}>
          <LazyStatsTab active viewModel={vm()} />
        </Loading>
      )
    },
  )
}
