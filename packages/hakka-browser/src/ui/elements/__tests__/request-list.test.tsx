import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destroyStore, initStore } from '../../../worker'
/**
 * Tests for `<hakka-request-list>` (elements/request-list.tsx) — ADR 0003
 * (b)/(c). Real custom-element upgrade in happy-dom, not
 * `@solidjs/testing-library` render — these are custom elements, not bare
 * Solid components.
 */
import { createStoreClient } from '../../../worker/storeClient'
import { setPreset } from '../../presets'
import { register, TAG } from '../request-list'
import { sharedFilterViewModel, sharedSelectionViewModel } from '../shared'
import { flush, makeLocalStorageMock, makeRequest, waitFor, waitForShadowContent } from '../testHarness'

const lsMock = makeLocalStorageMock()

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  initStore({ forceInProcess: true })
  register()
})

afterEach(() => {
  document.querySelectorAll(TAG).forEach((el) => el.remove())
  destroyStore()
  // Module-level singletons (elements/shared.ts) — reset the bits this
  // file's group-by/select-mode tests seed so they don't leak into the next
  // test (see filter-bar.test.tsx's afterEach for the same discipline).
  if (sharedFilterViewModel().getSnapshot().groupBy !== 'none') sharedFilterViewModel().intents.setGroupBy('none')
  sharedSelectionViewModel().intents.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('<hakka-request-list>', () => {
  it('mounts standalone in the DOM and renders the shared store singleton by default', async () => {
    const client = initStore({ forceInProcess: true })
    client.ingest(makeRequest({ url: 'https://api.example.com/shared-req' }))

    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot).toBeTruthy()
    expect(el.shadowRoot!.querySelector('.hakka-row-path')?.textContent).toContain('/shared-req')
  })

  it('an injected `store` property bypasses the shared singleton entirely', async () => {
    // A second, independent in-process store — proves injection routes to
    // THIS store, not the module-level singleton `initStore` above created.
    const injected = createStoreClient({ forceInProcess: true })
    injected.ingest(makeRequest({ url: 'https://injected.example.com/only-here' }))

    const el = document.createElement(TAG) as HTMLElement & { store: unknown }
    // Set before connecting — component-register's constructor pre-seeds
    // `this[key] = undefined` for every declared prop, so a property set
    // pre-upgrade is still picked up correctly.
    el.store = injected
    document.body.appendChild(el)
    // Not `waitForShadowContent` — once the lazy `RequestList` chunk is warm
    // (cached from an earlier test), the empty-state fallback renders
    // synchronously and satisfies "any content", racing ahead of the
    // view-model's async snapshot + microtask-deferred effect subscription.
    // Wait for the actual row instead.
    await waitFor(() => !!el.shadowRoot?.querySelector('.hakka-row-path'))

    const text = el.shadowRoot!.textContent ?? ''
    expect(text).toContain('only-here')
    expect(el.shadowRoot!.querySelector('.hakka-row-path')?.textContent).not.toContain('shared-req')
  })

  it('compact attribute reflects onto the rendered list', async () => {
    const el = document.createElement(TAG)
    el.setAttribute('compact', 'true')
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.querySelector('.hakka-list.compact')).toBeTruthy()
  })

  it('group-by attribute groups the rendered rows', async () => {
    const client = initStore({ forceInProcess: true })
    client.ingest(makeRequest({ url: 'https://a.example.com/one' }))
    client.ingest(makeRequest({ url: 'https://b.example.com/two' }))

    const el = document.createElement(TAG)
    el.setAttribute('group-by', 'host')
    document.body.appendChild(el)
    // See the injected-store test above for why `waitForShadowContent` alone
    // races ahead of the view-model's async snapshot + effect subscription.
    await waitFor(() => (el.shadowRoot?.querySelectorAll('.hakka-group-header').length ?? 0) >= 2)

    const headers = el.shadowRoot!.querySelectorAll('.hakka-group-header')
    expect(headers.length).toBeGreaterThanOrEqual(2)
  })

  it('hakka:select fires composed + bubbling with the clicked row id', async () => {
    const client = initStore({ forceInProcess: true })
    const req = makeRequest({ url: 'https://api.example.com/click-me' })
    client.ingest(req)

    const el = document.createElement(TAG)
    document.body.appendChild(el)
    // See the injected-store test above for why `waitForShadowContent` alone
    // races ahead of the view-model's async snapshot + effect subscription.
    await waitFor(() => !!el.shadowRoot?.querySelector('.hakka-row'))

    const seen: CustomEvent[] = []
    document.addEventListener('hakka:select', (e) => seen.push(e as CustomEvent))

    const row = el.shadowRoot!.querySelector('.hakka-row') as HTMLElement
    row.click()

    expect(seen.length).toBe(1)
    expect(seen[0]!.bubbles).toBe(true)
    expect(seen[0]!.composed).toBe(true)
    expect((seen[0]!.detail as { id: string }).id).toBe(req.id)
  })

  it('unmount stops the element from receiving further theme updates (theme-root unregistered)', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await flush()

    setPreset('light')
    const bgAfterLight = el.style.getPropertyValue('--hakka-bg')
    expect(bgAfterLight).toBe('#FAF8F4')

    el.remove()
    await flush()

    setPreset('high-contrast')
    // Still light's value — a disconnected element is no longer in
    // presets.ts's `activeRoots` registry, so it never sees this update.
    expect(el.style.getPropertyValue('--hakka-bg')).toBe(bgAfterLight)
  })
})
