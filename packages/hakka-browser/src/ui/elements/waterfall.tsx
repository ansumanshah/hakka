/**
 * `<hakka-waterfall>` — ADR 0003 (b)/(c). Wraps `../TraceWaterfall.tsx`
 * unmodified — a pure, props-driven renderer with no ownable business state
 * (`viewModels/index.ts`: "TraceWaterfall and JsonViewer have no
 * view-model").
 *
 * Attributes: `verbose` (bool — show non-primary framework spans). Properties:
 * `group` (`RequestGroup`, required), `selectedId` (string | null), `spans`
 * (`FrameworkSpan[]`, default `[]`). Events: `hakka:select` (`detail: { id:
 * string }`, replacing `TraceWaterfall.tsx`'s own `onSelect` callback prop).
 *
 * SSR: uses `lazy()` + `<Loading>`, not a bare `import()` — see
 * `request-list.tsx`'s file doc comment for why.
 */
import { customElement } from '@solidjs/element'
import type { FrameworkSpan, RequestGroup } from 'hakka-core'
import { lazy, Loading, onSettled, Show } from 'solid-js'

import {
  adoptSharedStyles,
  asHakkaElement,
  canRegisterElements,
  fireHakkaEvent,
  isRegistered,
  registerThemeRoot,
} from './shared'
import { WATERFALL_TAG } from './tags'

export const TAG = WATERFALL_TAG

// See the file doc comment's SSR note — evaluating this line never calls
// import() itself; that's deferred to first render.
const LazyTraceWaterfall = lazy(() => import('../TraceWaterfall').then((m) => ({ default: m.TraceWaterfall })))

interface WaterfallElementProps {
  group: RequestGroup | null
  selectedId: string | null
  /** Object property, `[]` default — see the "Object properties" note below. */
  spans: FrameworkSpan[]
  verbose: boolean
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
      group: null as RequestGroup | null,
      selectedId: null as string | null,
      spans: [] as FrameworkSpan[],
      verbose: false,
    },
    (props: WaterfallElementProps, { element: rawElement }) => {
      const element = asHakkaElement(rawElement)
      adoptSharedStyles(element.renderRoot)
      onSettled(() => registerThemeRoot(element))

      return (
        <Show
          when={props.group}
          fallback={
            <div class="hakka-list-empty">
              <span class="hakka-empty-title">No group provided</span>
            </div>
          }
        >
          {(group) => (
            <Loading fallback={null}>
              <LazyTraceWaterfall
                group={group()}
                selectedId={props.selectedId}
                onSelect={(req) => fireHakkaEvent(element, 'hakka:select', { id: req.id })}
                spans={props.spans}
                verbose={props.verbose}
              />
            </Loading>
          )}
        </Show>
      )
    },
  )
}
