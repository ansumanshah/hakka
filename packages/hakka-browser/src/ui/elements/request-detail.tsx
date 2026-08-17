/**
 * `<hakka-request-detail>` — ADR 0003 (b)/(c). Wraps `../Detail.tsx`
 * unmodified.
 *
 * Attributes: `request-id`, resolved against the shared store singleton
 * (no injectable `store` property here, unlike request-list/filter-bar/
 * stats). Properties: `request` (a full `NetworkRequest`, bypasses store
 * resolution) — wins over `request-id` when both are set (ADR 0003 (b)).
 * Events: `hakka:back` (replaces `Detail.tsx`'s `onBack` prop — a function
 * can't cross a custom-element property boundary the way a CustomEvent
 * can).
 *
 * This element only resolves WHICH request to show; `Detail.tsx` still does
 * its own body hydration via its default view-model when no `viewModel`
 * prop is passed.
 *
 * SSR: uses `lazy()` + `<Suspense>`, not a bare `import()` — see
 * `request-list.tsx`'s file doc comment for why (keeps `register()`
 * synchronous, defers the compiled Solid template until a real instance
 * renders).
 */
import { customElement } from '@solidjs/element'
import type { NetworkRequest } from 'hakka-core'
import { createEffect, createSignal, lazy, onSettled, Show, Loading } from 'solid-js'

import {
  adoptSharedStyles,
  asHakkaElement,
  canRegisterElements,
  fireHakkaEvent,
  isRegistered,
  registerThemeRoot,
  sharedStore,
} from './shared'
import { REQUEST_DETAIL_TAG } from './tags'

export const TAG = REQUEST_DETAIL_TAG

// See the file doc comment's SSR note — evaluating this line never calls
// import() itself; that's deferred to first render.
const LazyDetail = lazy(() => import('../Detail').then((m) => ({ default: m.Detail })))

interface RequestDetailElementProps {
  requestId: string
  request: NetworkRequest | null
}

/** Idempotent — safe to call more than once (a no-op after the first, and a
 * no-op — not a throw — anywhere `customElements` doesn't exist). */
export function register(): void {
  if (!canRegisterElements() || isRegistered(TAG)) return
  customElement(
    TAG,
    {
      requestId: '',
      // Must declare object props (null default is fine) — an undeclared
      // one silently stringifies to "[object Object]" in a React host.
      request: null as NetworkRequest | null,
    },
    (props: RequestDetailElementProps, { element: rawElement }) => {
      const element = asHakkaElement(rawElement)
      adoptSharedStyles(element.renderRoot)
      onSettled(() => {
        const unregister = registerThemeRoot(element)
        return unregister
      })

      const [resolved, setResolved] = createSignal<NetworkRequest | null>(null)

      // Resolution order per ADR 0003 (b): an injected `request` always wins;
      // otherwise resolve `request-id` against the shared store's snapshot.
      // A pending id not yet in the snapshot stays subscribed until it
      // arrives, the id changes, or the element unmounts.
      createEffect(
        () => ({ request: props.request, requestId: props.requestId }),
        ({ request, requestId }) => {
          if (request) {
            setResolved(request)
            return
          }
          if (!requestId) {
            setResolved(null)
            return
          }
          let cancelled = false
          const client = sharedStore()
          void client.getSnapshot().then((snap) => {
            if (cancelled) return
            const found = snap.find((r) => r.id === requestId) ?? null
            if (found) setResolved(found)
          })
          const unsub = client.subscribe((incoming) => {
            if (!cancelled && incoming.id === requestId) setResolved(incoming)
          })
          return () => {
            cancelled = true
            unsub()
          }
        },
      )

      return (
        <Show
          when={resolved()}
          fallback={
            <div class="hakka-list-empty">
              <span class="hakka-empty-title">No request selected</span>
            </div>
          }
        >
          {(req) => (
            <Loading fallback={null}>
              <LazyDetail req={req()} onBack={() => fireHakkaEvent(element, 'hakka:back', {})} />
            </Loading>
          )}
        </Show>
      )
    },
  )
}
