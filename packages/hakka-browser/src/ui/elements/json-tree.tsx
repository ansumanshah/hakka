/**
 * `<hakka-json-tree>` — ADR 0003 (b)/(c). Wraps `../JsonViewer.tsx`
 * unmodified — a pure, props-driven renderer with no ownable business state.
 *
 * Attributes: `max-depth` (number, default 2 — nodes at `depth >= max-depth`
 * start collapsed). Properties: `value` (any JSON-shaped value, serialized
 * before reaching `JsonViewer`) or `text` (raw JSON string). `value` wins
 * when both are set (undocumented by the ADR; this element's own choice).
 * Events: none — pure display, same as `Detail`.
 *
 * SSR: uses `lazy()` + `<Suspense>`, not a bare `import()` — see
 * `request-list.tsx`'s file doc comment for why.
 */
import { customElement } from '@solidjs/element'
import { createMemo, lazy, onSettled, Loading } from 'solid-js'

import { adoptSharedStyles, asHakkaElement, canRegisterElements, isRegistered, registerThemeRoot } from './shared'
import { JSON_TREE_TAG } from './tags'

export const TAG = JSON_TREE_TAG

// See the file doc comment's SSR note — evaluating this line never calls
// import() itself; that's deferred to first render.
const LazyJsonViewer = lazy(() => import('../JsonViewer').then((m) => ({ default: m.JsonViewer })))

interface JsonTreeElementProps {
  maxDepth: number
  value: unknown
  text: string | null
}

/** Idempotent — safe to call more than once (a no-op after the first, and a
 * no-op — not a throw — anywhere `customElements` doesn't exist). */
export function register(): void {
  if (!canRegisterElements() || isRegistered(TAG)) return
  customElement(
    TAG,
    {
      maxDepth: 2,
      // Must declare object props (null default is fine) — an undeclared
      // one silently stringifies to "[object Object]" in a React host.
      value: null as unknown,
      text: null as string | null,
    },
    (props: JsonTreeElementProps, { element: rawElement }) => {
      const element = asHakkaElement(rawElement)
      adoptSharedStyles(element.renderRoot)
      onSettled(() => {
        const unregister = registerThemeRoot(element)
        return unregister
      })

      // `value` wins when both are set — see the file doc comment above.
      const text = createMemo<string | null | undefined>(() => {
        if (props.value !== null && props.value !== undefined) {
          try {
            return JSON.stringify(props.value)
          } catch {
            return String(props.value)
          }
        }
        return props.text
      })

      return (
        <Loading fallback={null}>
          <LazyJsonViewer text={text()} maxDepth={props.maxDepth} />
        </Loading>
      )
    },
  )
}
