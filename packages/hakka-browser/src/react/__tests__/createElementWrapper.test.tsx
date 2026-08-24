import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createElementWrapper } from '../createElementWrapper'
import { flush } from '../testHarness'

/**
 * Isolated unit test for `createElementWrapper`, against a hand-rolled fake
 * element rather than a real `hakka-browser/elements` one — see
 * `RequestList.test.tsx`/`JsonTree.test.tsx` for integration coverage. Kept
 * separate because happy-dom's `CustomElementRegistry.upgrade()` is a no-op
 * (a node created before `register()` runs never becomes a real instance
 * here, unlike a real browser) — which is exactly why `register()` must run
 * synchronously during render, before `createElement(tag, ...)` commits, and
 * not from a later effect: the very first mount of any given tag has to see
 * an already-defined custom element, or an object prop like `store`/
 * `viewModel` stringifies to `"[object Object]"` with no way back.
 */

let roots: Root[] = []
let containers: HTMLElement[] = []

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount()
  })
  for (const c of containers) c.remove()
  roots = []
  containers = []
  vi.restoreAllMocks()
})

async function mount(el: React.ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  containers.push(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(el)
  })
  await flush()
  return container
}

describe('createElementWrapper', () => {
  it('does not call register() merely from building the wrapper — only once it actually renders', () => {
    const register = vi.fn()
    createElementWrapper('fake-widget', register, {})
    // Nothing has rendered yet, so register() must not have fired.
    expect(register).not.toHaveBeenCalled()
  })

  it('invokes register() once mounted', async () => {
    const register = vi.fn()
    const Widget = createElementWrapper<{ label?: string }>('fake-widget-2', register, {})

    await mount(createElement(Widget, { label: 'hi' }))

    expect(register).toHaveBeenCalledTimes(1)
  })

  it('calls register() before the custom element is constructed, not after — proves the ordering the first-mount fix depends on', async () => {
    const order: string[] = []
    const tag = 'fake-widget-order'
    const register = vi.fn(() => {
      order.push('register')
      if (!customElements.get(tag)) {
        customElements.define(
          tag,
          class extends HTMLElement {
            constructor() {
              super()
              order.push('construct')
            }
          },
        )
      }
    })
    const Widget = createElementWrapper(tag, register, {})

    await mount(createElement(Widget, {}))

    // If register() ran from a useEffect (the old, buggy ordering),
    // `document.createElement(tag)` — and so the class constructor — would
    // run first, since that commit happens synchronously well before any
    // passive effect. Registering only from the render body guarantees
    // 'register' precedes 'construct'.
    expect(order).toEqual(['register', 'construct'])
  })

  it('an object prop survives the very first mount of a never-before-registered tag, even under StrictMode double-invocation', async () => {
    const tag = 'fake-widget-store'
    const register = vi.fn(() => {
      if (!customElements.get(tag)) {
        customElements.define(
          tag,
          class extends HTMLElement {
            store: unknown = null
          },
        )
      }
    })
    const Widget = createElementWrapper<{ store?: unknown }>(tag, register, {})
    const storeObj = { hello: 'world' }

    const container = document.createElement('div')
    document.body.appendChild(container)
    containers.push(container)
    const root = createRoot(container)
    roots.push(root)
    await act(async () => {
      // StrictMode double-invokes the render body in development — register()
      // must tolerate that (it's idempotent) and still win the race against
      // this same render's `createElement(tag, ...)` commit.
      root.render(createElement(StrictMode, null, createElement(Widget, { store: storeObj })))
    })
    await flush()

    const el = container.querySelector(tag) as (HTMLElement & { store: unknown }) | null
    expect(el).toBeTruthy()
    // Reference equality — proves it arrived as a real DOM property, not a
    // stringified "[object Object]" attribute the object identity can't
    // survive.
    expect(el!.store).toBe(storeObj)
    expect(el!.hasAttribute('store')).toBe(false)
  })
})
