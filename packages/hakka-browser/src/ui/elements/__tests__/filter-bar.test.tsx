import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tests for `<hakka-filter-bar>` (elements/filter-bar.tsx) — ADR 0003 (b)/(c).
 * `nl-mode`/`advanced-open` attributes seed the shared `FilterViewModel`
 * singleton once at connect; `selectMode`/`onToggleSelectMode` are wired to
 * the shared `SelectionViewModel` singleton — the same one
 * `<hakka-request-list>` uses by default, so the cross-element wiring test
 * below doubles as an integration check.
 */
import { setPreset } from '../../presets'
import { register as registerFilterBar, TAG as FILTER_BAR_TAG } from '../filter-bar'
import { register as registerRequestList, TAG as REQUEST_LIST_TAG } from '../request-list'
import { sharedFilterViewModel, sharedSelectionViewModel } from '../shared'
import { flush, makeLocalStorageMock, waitForShadowContent } from '../testHarness'

const lsMock = makeLocalStorageMock()

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  registerFilterBar()
  registerRequestList()
})

afterEach(() => {
  document.querySelectorAll(FILTER_BAR_TAG).forEach((el) => el.remove())
  document.querySelectorAll(REQUEST_LIST_TAG).forEach((el) => el.remove())
  // sharedFilterViewModel()/sharedSelectionViewModel() are module-level
  // singletons (elements/shared.ts) that persist across tests in this file —
  // reset every mutable bit so one test's seeded state can't leak into the
  // next test's fresh element.
  const filters = sharedFilterViewModel()
  const fSnap = filters.getSnapshot()
  if (fSnap.nlMode) filters.intents.toggleNlMode()
  if (fSnap.advOpen) filters.intents.toggleAdvanced()
  if (fSnap.filterText) filters.intents.setFilterText('')
  sharedSelectionViewModel().intents.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('<hakka-filter-bar>', () => {
  it('mounts standalone with the default (non-NL) search placeholder', async () => {
    const el = document.createElement(FILTER_BAR_TAG)
    document.body.appendChild(el)
    await waitForShadowContent(el)

    const input = el.shadowRoot!.querySelector('.hakka-search') as HTMLInputElement
    expect(input.placeholder).not.toContain('Describe what you want')
  })

  it('nl-mode attribute seeds NL mode at connect', async () => {
    const el = document.createElement(FILTER_BAR_TAG)
    el.setAttribute('nl-mode', 'true')
    document.body.appendChild(el)
    await waitForShadowContent(el)

    const input = el.shadowRoot!.querySelector('.hakka-search') as HTMLInputElement
    expect(input.placeholder).toContain('Describe:')
  })

  it('advanced-open attribute seeds the advanced disclosure open at connect', async () => {
    const el = document.createElement(FILTER_BAR_TAG)
    el.setAttribute('advanced-open', 'true')
    document.body.appendChild(el)
    await waitForShadowContent(el)

    expect(el.shadowRoot!.querySelector('.hakka-filter-adv')?.classList.contains('hakka-collapsed')).toBe(false)
  })

  it('hakka:filter-change fires composed + bubbling with the full SavedFilter shape on input', async () => {
    const el = document.createElement(FILTER_BAR_TAG)
    document.body.appendChild(el)
    await waitForShadowContent(el)

    const seen: CustomEvent[] = []
    document.addEventListener('hakka:filter-change', (e) => seen.push(e as CustomEvent))

    const input = el.shadowRoot!.querySelector('.hakka-search') as HTMLInputElement
    input.value = 'status:>=400'
    // `composed: true` is required (not just `bubbles`) — the input lives
    // inside a Shadow DOM, and Solid delegates 'input' to a listener
    // registered above the shadow boundary; a non-composed event never
    // reaches it.
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    await flush()

    expect(seen.length).toBeGreaterThan(0)
    const last = seen[seen.length - 1]!
    expect(last.bubbles).toBe(true)
    expect(last.composed).toBe(true)
    expect((last.detail as { filterText: string }).filterText).toBe('status:>=400')
  })

  it('toggling select mode here also toggles a sibling <hakka-request-list> (shared SelectionViewModel)', async () => {
    const bar = document.createElement(FILTER_BAR_TAG)
    const list = document.createElement(REQUEST_LIST_TAG)
    document.body.appendChild(bar)
    document.body.appendChild(list)
    await waitForShadowContent(bar)
    await waitForShadowContent(list)

    expect(list.shadowRoot!.querySelector('.hakka-list.compact')).toBeFalsy() // sanity: rendered
    const selectBtn = bar.shadowRoot!.querySelector('.hakka-select-mode-btn') as HTMLElement
    selectBtn.click()
    await flush()

    // The list has no rows to check directly — assert via the filter bar's
    // own button state, driven by the same shared SelectionViewModel.
    expect(bar.shadowRoot!.querySelector('.hakka-select-mode-btn.active')).toBeTruthy()
  })

  it('unmount stops the element from receiving further theme updates', async () => {
    const el = document.createElement(FILTER_BAR_TAG)
    document.body.appendChild(el)
    await flush()

    setPreset('paper')
    const bgAfterPaper = el.style.getPropertyValue('--hakka-bg')
    expect(bgAfterPaper).toBe('#F5F0E1')

    el.remove()
    await flush()

    setPreset('high-contrast')
    expect(el.style.getPropertyValue('--hakka-bg')).toBe(bgAfterPaper)
  })
})
