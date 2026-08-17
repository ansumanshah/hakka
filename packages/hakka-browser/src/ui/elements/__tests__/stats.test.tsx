import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destroyStore, initStore } from '../../../worker'
/**
 * Tests for `<hakka-stats>` (elements/stats.tsx) — ADR 0003 (b)/(c). No
 * attributes, `store`/`viewModel` properties (optional), no events.
 */
import { createStoreClient } from '../../../worker/storeClient'
import { setPreset } from '../../presets'
import { register, TAG } from '../stats'
import { flush, makeLocalStorageMock, makeRequest, waitForShadowContent } from '../testHarness'

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

describe('<hakka-stats>', () => {
  it('mounts standalone and aggregates the shared store singleton by default', async () => {
    const client = initStore({ forceInProcess: true })
    client.ingest(makeRequest({ status: 200 }))
    client.ingest(makeRequest({ status: 404 }))

    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await waitForShadowContent(el)

    // No tab-level header/count (DESIGN.md "Panel section anatomy" — the tab
    // strip is the title) — "Total requests2" is the Overview table's own
    // first row, key cell immediately followed by the value cell.
    expect(el.shadowRoot!.textContent).toContain('Total requests2')
  })

  it('an injected `store` property bypasses the shared singleton entirely', async () => {
    const injected = createStoreClient({ forceInProcess: true })
    injected.ingest(makeRequest({}))
    injected.ingest(makeRequest({}))
    injected.ingest(makeRequest({}))

    const el = document.createElement(TAG) as HTMLElement & { store: unknown }
    el.store = injected
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.textContent).toContain('Total requests3')
  })

  it('unmount stops the element from receiving further theme updates', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await flush()

    setPreset('matrix')
    const bgAfterMatrix = el.style.getPropertyValue('--hakka-bg')
    expect(bgAfterMatrix).toBe('#000000')

    el.remove()
    await flush()

    setPreset('amber')
    expect(el.style.getPropertyValue('--hakka-bg')).toBe(bgAfterMatrix)
  })
})
