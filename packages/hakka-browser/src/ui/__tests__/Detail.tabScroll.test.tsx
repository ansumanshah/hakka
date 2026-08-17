/**
 * Detail's secondary tab strip (.hakka-tabs) keeps the active tab scrolled
 * into view when it changes — the adopted-from-research guarantee in the
 * inspector design audit (Bruno's ResponsiveTabs, minus the dropdown-menu
 * machinery). Covers: the call itself, prefers-reduced-motion swapping
 * 'smooth' for 'auto', and the jsdom/happy-dom guard when scrollIntoView is
 * unavailable.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Detail } from '../Detail'

// Solid 2.0 batches signal writes to a microtask — flush past it before
// asserting on the DOM after a click.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'tab-scroll-1',
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  } as NetworkRequest
}

function clickTab(container: HTMLElement, label: string): void {
  const btn = Array.from(container.querySelectorAll('.hakka-tab')).find((t) => t.textContent === label) as HTMLElement
  fireEvent.click(btn)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Detail — active tab scrolled into view', () => {
  it('scrolls the newly active tab into view with inline:nearest', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    await flush()
    spy.mockClear() // ignore the mount-time call for the default 'overview' tab

    clickTab(container, 'Request')
    await flush()

    const activeTab = Array.from(container.querySelectorAll('.hakka-tab')).find((t) => t.textContent === 'Request')
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.instances).toContain(activeTab)
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ inline: 'nearest' }))
  })

  it('uses smooth scrolling by default', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    await flush()
    spy.mockClear()

    clickTab(container, 'Timing')
    await flush()

    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('switches to instant scrolling under prefers-reduced-motion', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
    const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
    await flush()
    spy.mockClear()

    clickTab(container, 'Response')
    await flush()

    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('does not throw when scrollIntoView is unavailable (jsdom/happy-dom gap)', async () => {
    const original = HTMLElement.prototype.scrollIntoView
    // @ts-expect-error — simulate an environment (like jsdom) that never implemented it.
    delete HTMLElement.prototype.scrollIntoView
    try {
      const { container } = render(() => <Detail req={req()} onBack={() => {}} />)
      await flush()
      expect(() => clickTab(container, 'Response')).not.toThrow()
      await flush()
    } finally {
      HTMLElement.prototype.scrollIntoView = original
    }
  })
})
