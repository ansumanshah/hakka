import { register as registerJsonTree, TAG } from 'hakka-browser/elements/json-tree'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { JsonTree } from '../JsonTree'
import { flush, makeLocalStorageMock, waitForShadowContent } from '../testHarness'

/**
 * Integration test against the REAL `<hakka-json-tree>` custom element. See
 * `RequestList.test.tsx` for why `registerJsonTree()` runs in `beforeAll`
 * (happy-dom's `CustomElementRegistry.upgrade()` is a no-op). No events here,
 * so this file covers render/registration, property-not-attribute, and ref;
 * `RequestList.test.tsx` covers events + unmount cleanup.
 */
const lsMock = makeLocalStorageMock()

beforeAll(() => {
  registerJsonTree()
})

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

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

describe('<JsonTree>', () => {
  it('renders and registers the underlying custom element', async () => {
    const { container, root } = await mount(createElement(JsonTree, {}))

    const el = container.querySelector(TAG) as (HTMLElement & { shadowRoot: ShadowRoot | null }) | null
    expect(el).toBeTruthy()
    expect(customElements.get(TAG)).toBeTruthy()
    expect(el!.shadowRoot).toBeTruthy()
    // JsonViewer loads behind lazy() + Suspense — wait for it to render
    // rather than relying on one flush() tick.
    await waitForShadowContent(el!)
    expect(el!.shadowRoot!.textContent).toContain('No body')

    await unmount(container, root)
  })

  it('an object property (value) arrives as a DOM property, not an attribute, and renders', async () => {
    const value = { hello: 'world', n: 42 }
    const { container, root } = await mount(createElement(JsonTree, { value }))

    const el = container.querySelector(TAG) as HTMLElement & { value: unknown }
    expect(el.value).toBe(value) // strict reference equality — proves it's a real property
    expect(el.hasAttribute('value')).toBe(false)

    await waitForShadowContent(el)
    const tree = el.shadowRoot!.querySelector('.hakka-json')
    expect(tree?.textContent).toContain('hello')
    expect(tree?.textContent).toContain('world')

    await unmount(container, root)
  })

  it('a text property renders identically, and value wins when both are set', async () => {
    const { container, root } = await mount(createElement(JsonTree, { text: JSON.stringify({ from: 'text' }) }))
    const el1 = container.querySelector(TAG) as HTMLElement & { shadowRoot: ShadowRoot | null }
    await waitForShadowContent(el1)
    expect(el1.shadowRoot!.textContent).toContain('text')

    await unmount(container, root)

    const { container: c2, root: r2 } = await mount(
      createElement(JsonTree, { text: JSON.stringify({ from: 'text' }), value: { from: 'value' } }),
    )
    const el2 = c2.querySelector(TAG) as HTMLElement & { shadowRoot: ShadowRoot | null }
    await waitForShadowContent(el2)
    const text = el2.shadowRoot!.textContent ?? ''
    expect(text).toContain('value')
    expect(text).not.toContain('"from": "text"')

    await unmount(c2, r2)
  })

  it('ref exposes the underlying custom element', async () => {
    let refEl: HTMLElement | null = null
    const { container, root } = await mount(
      createElement(JsonTree, {
        value: { a: 1 },
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
