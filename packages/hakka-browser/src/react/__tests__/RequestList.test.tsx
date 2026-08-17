import { register as registerRequestList, TAG } from 'hakka-browser/elements/request-list'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { RequestList } from '../RequestList'
import { flush, makeLocalStorageMock } from '../testHarness'

/**
 * Integration test against the REAL `<hakka-request-list>` custom element —
 * proves properties arrive as DOM properties (not attributes), `hakka:select`
 * binds via `ref.addEventListener` (not React's `onSelect` path), unmount
 * tears the listener down, and `ref` exposes the element.
 *
 * `registerRequestList()` runs once in `beforeAll`, before any element is
 * created — happy-dom's `CustomElementRegistry.upgrade()` is a no-op, so a
 * node created before the tag is defined never becomes a real instance later
 * (unlike a real browser). This doesn't change the component's own lazy
 * `register()`-in-`useEffect` behavior, which stays idempotent.
 */
const lsMock = makeLocalStorageMock()

beforeAll(() => {
  registerRequestList()
})

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Minimal stand-in for `RequestListViewModel` — satisfies `request-list.tsx`'s
 * `isFullViewModel` duck-type check and bypasses the shared store/worker
 * singleton, so these tests exercise only the React wrapper's own contract. */
function fakeViewModel() {
  return {
    getSnapshot: () => ({ filtered: [], logs: [], groups: [] }),
    subscribe: () => () => {},
    intents: {},
  }
}

async function mount(el: React.ReactElement): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(el)
  })
  await flush()
  return { container, root }
}

async function unmount(container: HTMLElement, root: Root): Promise<void> {
  await act(async () => root.unmount())
  container.remove()
}

describe('<RequestList>', () => {
  it('renders and registers the underlying custom element', async () => {
    const { container, root } = await mount(createElement(RequestList, { viewModel: fakeViewModel() }))

    const el = container.querySelector(TAG) as (HTMLElement & { shadowRoot: ShadowRoot | null }) | null
    expect(el).toBeTruthy()
    expect(customElements.get(TAG)).toBeTruthy()
    expect(el!.shadowRoot).toBeTruthy()

    await unmount(container, root)
  })

  it('an object property (viewModel) arrives as a DOM property, not an attribute', async () => {
    const vm = fakeViewModel()
    const { container, root } = await mount(createElement(RequestList, { viewModel: vm }))

    const el = container.querySelector(TAG) as HTMLElement & { viewModel: unknown }
    expect(el.viewModel).toBe(vm) // strict reference equality — proves it's a real property, not a stringified copy
    expect(el.hasAttribute('viewmodel')).toBe(false)
    expect(el.hasAttribute('viewModel')).toBe(false)

    await unmount(container, root)
  })

  it('onSelect fires with the event detail when hakka:select dispatches', async () => {
    const calls: Array<{ id: string }> = []
    const { container, root } = await mount(
      createElement(RequestList, { viewModel: fakeViewModel(), onSelect: (d) => calls.push(d) }),
    )

    const el = container.querySelector(TAG) as HTMLElement
    el.dispatchEvent(new CustomEvent('hakka:select', { detail: { id: 'req-1' } }))
    await flush()

    expect(calls).toEqual([{ id: 'req-1' }])

    await unmount(container, root)
  })

  it('unmount removes the hakka:select listener', async () => {
    let fired = 0
    const { container, root } = await mount(
      createElement(RequestList, { viewModel: fakeViewModel(), onSelect: () => fired++ }),
    )

    const el = container.querySelector(TAG) as HTMLElement
    el.dispatchEvent(new CustomEvent('hakka:select', { detail: { id: 'a' } }))
    await flush()
    expect(fired).toBe(1)

    await unmount(container, root)
    await flush()

    el.dispatchEvent(new CustomEvent('hakka:select', { detail: { id: 'b' } }))
    await flush()
    expect(fired).toBe(1) // unchanged — the listener was torn down on unmount
  })

  it('ref exposes the underlying custom element', async () => {
    let refEl: HTMLElement | null = null
    const { container, root } = await mount(
      createElement(RequestList, {
        viewModel: fakeViewModel(),
        ref: (node: HTMLElement | null) => {
          refEl = node
        },
      }),
    )

    const el = container.querySelector(TAG)
    expect(refEl).toBe(el)
    // Non-null assertion, not `?.` — proven non-null by `toBe(el)` above;
    // TS 6.0.3 mis-narrows this closure-mutated `let` to `never` here (a
    // compiler quirk, not a real nullability gap).
    expect(refEl!.tagName.toLowerCase()).toBe(TAG)

    await unmount(container, root)
  })
})
