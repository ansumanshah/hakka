import { createElement, forwardRef, useCallback, useEffect, useRef } from 'react'
import type { ForwardedRef, ForwardRefExoticComponent, PropsWithoutRef, ReactElement, RefAttributes } from 'react'

/**
 * Maps a React prop name (e.g. `onSelect`) to the DOM `CustomEvent` name
 * (e.g. `hakka:select`). Bound via `addEventListener`, not React's `onX` path
 * — React lowercases the suffix (`onHakkaSelect` → `'hakkaselect'`) and the
 * colon in `hakka:select` can't appear in a prop name at all.
 */
export type EventMap = Record<string, string>

/**
 * Builds a thin `forwardRef` React wrapper around one of
 * `hakka-browser/elements`'s six custom elements.
 *
 * - Props not listed in `events` pass straight to `React.createElement(tag,
 *   ...)` — React 19 assigns each as a DOM property when the element's class
 *   already declares it (`key in domElement` at commit time), falling back
 *   to a stringified attribute otherwise. Object props (`store`, `viewModel`,
 *   …) only survive that check.
 * - Props listed in `events` bind via `ref.addEventListener` instead, rebound
 *   each render and cleaned up on unmount.
 * - `register()` runs synchronously in the render body, NOT from a
 *   `useEffect` — `createElement(tag, ...)` below commits its initial props
 *   in the same synchronous phase, before any effect runs, so
 *   `customElements.define()` must already have happened by then or the
 *   element is still an un-upgraded plain node and every object prop
 *   silently stringifies to `"[object Object]"` with no way to recover it
 *   once the tag does upgrade. `register()` is idempotent and SSR-safe (see
 *   its own doc comment), so calling it unconditionally on every render —
 *   including React 18 StrictMode's double-invoked render — is a no-op after
 *   the first.
 */
export function createElementWrapper<P extends object, E extends HTMLElement = HTMLElement>(
  tag: string,
  register: () => void,
  events: EventMap,
): ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<E>> {
  function HakkaElement(props: P, forwardedRef: ForwardedRef<E>): ReactElement {
    const elRef = useRef<E | null>(null)
    const propsRecord = props as Record<string, unknown>

    // Must run here, synchronously during render — see the doc comment
    // above. A `useEffect` runs after this render's `createElement(tag,
    // ...)` call has already committed the element's initial props, which
    // is too late for the very first mount of any given tag.
    register()

    useEffect(() => {
      const el = elRef.current
      if (!el) return
      const unbind = Object.entries(events).map(([propName, eventName]) => {
        const handler = propsRecord[propName] as ((detail: unknown) => void) | undefined
        if (!handler) return undefined
        const listener = (e: Event) => handler((e as CustomEvent).detail)
        el.addEventListener(eventName, listener)
        return () => el.removeEventListener(eventName, listener)
      })
      return () => unbind.forEach((off) => off?.())
    })

    const elementProps: Record<string, unknown> = {}
    for (const key in propsRecord) {
      if (!(key in events)) elementProps[key] = propsRecord[key]
    }

    // Stable merged ref callback — runs at commit, not render.
    const setRefs = useCallback(
      (node: E | null) => {
        elRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      },
      [forwardedRef],
    )

    return createElement(tag, { ...elementProps, ref: setRefs })
  }

  // `forwardRef`'s generic signature can't express "P minus ref, plus ref
  // back as RefAttributes<E>" for an arbitrary generic P — the cast below
  // makes that explicit; it doesn't loosen the real prop types callers see.
  const Wrapped = forwardRef(
    HakkaElement as unknown as (props: PropsWithoutRef<P>, ref: ForwardedRef<E>) => ReactElement,
  )
  Wrapped.displayName = tag
  return Wrapped as ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<E>>
}
