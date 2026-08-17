/**
 * Tests for `<hakka-waterfall>` (elements/waterfall.tsx) — ADR 0003 (b)/(c).
 * Pure props-driven, no store/view-model — properties only (`group`,
 * `selectedId`), no attributes.
 */
import type { NetworkRequest, RequestGroup } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setPreset } from '../../presets'
import { flush, makeLocalStorageMock, makeRequest, waitForShadowContent } from '../testHarness'
import { register, TAG } from '../waterfall'

const lsMock = makeLocalStorageMock()

function makeGroup(items: NetworkRequest[]): RequestGroup {
  return { key: 'trace-1', label: 'trace-1', items }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  register()
})

afterEach(() => {
  document.querySelectorAll(TAG).forEach((el) => el.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('<hakka-waterfall>', () => {
  it('shows a placeholder with no group set', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await flush()

    expect(el.shadowRoot!.textContent).toContain('No group provided')
  })

  it('renders one hop per item in an injected group property', async () => {
    const items = [
      makeRequest({ url: 'https://api.example.com/hop-a', startTime: 0, duration: 10 }),
      makeRequest({ url: 'https://api.example.com/hop-b', startTime: 5, duration: 10 }),
    ]
    const el = document.createElement(TAG) as HTMLElement & { group: unknown }
    el.group = makeGroup(items)
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.querySelectorAll('.hakka-wf-hop').length).toBe(2)
  })

  it('selectedId property highlights the matching hop', async () => {
    const items = [makeRequest({ url: 'https://api.example.com/hop-a' })]
    const group = makeGroup(items)
    const el = document.createElement(TAG) as HTMLElement & { group: unknown; selectedId: unknown }
    el.group = group
    el.selectedId = items[0]!.id
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.querySelector('.hakka-wf-hop.selected')).toBeTruthy()
  })

  it('hakka:select fires composed + bubbling on hop click', async () => {
    const items = [makeRequest({ url: 'https://api.example.com/hop-click' })]
    const el = document.createElement(TAG) as HTMLElement & { group: unknown }
    el.group = makeGroup(items)
    document.body.appendChild(el)
    await waitForShadowContent(el)

    const seen: CustomEvent[] = []
    document.addEventListener('hakka:select', (e) => seen.push(e as CustomEvent))

    const hop = el.shadowRoot!.querySelector('.hakka-wf-hop') as HTMLElement
    hop.click()

    expect(seen.length).toBe(1)
    expect(seen[0]!.bubbles).toBe(true)
    expect(seen[0]!.composed).toBe(true)
    expect((seen[0]!.detail as { id: string }).id).toBe(items[0]!.id)
  })

  it('unmount stops the element from receiving further theme updates', async () => {
    const el = document.createElement(TAG)
    document.body.appendChild(el)
    await flush()

    setPreset('paper')
    const bgAfterPaper = el.style.getPropertyValue('--hakka-bg')
    expect(bgAfterPaper).toBe('#F5F0E1')

    el.remove()
    await flush()

    setPreset('navy')
    expect(el.style.getPropertyValue('--hakka-bg')).toBe(bgAfterPaper)
  })
})
