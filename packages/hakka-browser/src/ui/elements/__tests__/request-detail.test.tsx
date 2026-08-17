import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for `<hakka-request-detail>` (elements/request-detail.tsx) — ADR
 * 0003 (b)/(c). No `store` property exists for this element — it always
 * resolves `request-id` against the shared store singleton; `request`
 * bypasses resolution entirely.
 */
import { destroyStore, initStore } from '../../../worker'
import { setPreset } from '../../presets'
import { register, TAG } from '../request-detail'
import { flush, makeLocalStorageMock, makeRequest, waitFor } from '../testHarness'

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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('<hakka-request-detail>', () => {
  it('shows a placeholder before any request is selected', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await flush()

    expect(el.shadowRoot!.textContent).toContain('No request selected')
  })

  it('an injected `request` property bypasses store resolution entirely', async () => {
    const req = makeRequest({ url: 'https://api.example.com/direct-object', method: 'POST' })
    const el = document.createElement(TAG) as HTMLElement & { request: unknown }
    // Set before connecting — component-register pre-seeds this[key] =
    // undefined in the constructor, so this ordering is safe.
    el.request = req
    document.body.appendChild(el)
    // Solid 2's createEffect no longer resolves synchronously on initial
    // render, and the "No request selected" fallback has content of its
    // own — wait for the actual resolved Detail marker, not just any
    // shadow content.
    await waitFor(() => !!el.shadowRoot?.querySelector('.hakka-detail-rowback .hakka-row-path'))

    expect(el.shadowRoot!.querySelector('.hakka-detail-rowback .hakka-row-path')).toBeTruthy()
    expect(el.shadowRoot!.textContent).toContain('POST')
  })

  it('request-id attribute resolves against the shared store snapshot', async () => {
    const client = initStore({ forceInProcess: true })
    const req = makeRequest({ url: 'https://api.example.com/resolved-by-id' })
    client.ingest(req)
    await flush()

    const el = document.createElement(TAG)
    el.setAttribute('request-id', req.id)
    document.body.appendChild(el)
    // Same settle-gap as above — wait for the resolved Detail marker, not
    // just any shadow content.
    await waitFor(() => !!el.shadowRoot?.querySelector('.hakka-detail-rowback .hakka-row-host'))

    expect(el.shadowRoot!.querySelector('.hakka-detail-rowback .hakka-row-host')).toBeTruthy()
    expect(el.shadowRoot!.textContent).toContain('Request ID')
  })

  it('the `request` property wins when both request and request-id are set', async () => {
    const client = initStore({ forceInProcess: true })
    const byId = makeRequest({ url: 'https://api.example.com/by-id' })
    client.ingest(byId)
    const direct = makeRequest({ url: 'https://api.example.com/direct-wins' })

    const el = document.createElement(TAG) as HTMLElement & { request: unknown }
    el.setAttribute('request-id', byId.id)
    el.request = direct
    document.body.appendChild(el)
    // Same settle-gap as above — wait for the resolved Detail marker, not
    // just any shadow content (the fallback renders first).
    await waitFor(() => !!el.shadowRoot?.querySelector('.hakka-detail-rowback .hakka-row-path'))

    expect(el.shadowRoot!.textContent).toContain('direct-wins')
  })

  it('hakka:back fires composed + bubbling on the back button', async () => {
    const req = makeRequest({})
    const el = document.createElement(TAG) as HTMLElement & { request: unknown }
    el.request = req
    document.body.appendChild(el)
    // Same settle-gap — wait for the actual back button, not just any
    // shadow content (the fallback has none).
    await waitFor(() => !!el.shadowRoot?.querySelector('.hakka-back-btn'))

    const seen: CustomEvent[] = []
    document.addEventListener('hakka:back', (e) => seen.push(e as CustomEvent))

    const backBtn = el.shadowRoot!.querySelector('.hakka-back-btn') as HTMLElement
    backBtn.click()

    expect(seen.length).toBe(1)
    expect(seen[0]!.bubbles).toBe(true)
    expect(seen[0]!.composed).toBe(true)
  })

  it('unmount stops the element from receiving further theme updates', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await flush()

    setPreset('amber')
    const accentAfterAmber = el.style.getPropertyValue('--hakka-accent')
    expect(accentAfterAmber).toBe('#FFB000')

    el.remove()
    await flush()

    setPreset('matrix')
    expect(el.style.getPropertyValue('--hakka-accent')).toBe(accentAfterAmber)
  })
})
