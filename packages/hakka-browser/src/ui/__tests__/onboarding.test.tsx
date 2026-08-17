import { render, fireEvent } from '@solidjs/testing-library'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initStore, destroyStore } from '../../worker'
import { Inspector } from '../Inspector'
import { loadUiState } from '../persist'
import { buildSampleRequests } from '../sampleData'

// Follows the same fake-request + forceInProcess store conventions as Inspector.test.tsx.

// happy-dom does not provide localStorage unless --localstorage-file is set —
// stub a minimal in-memory implementation (same convention as settings.test.tsx).
function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? (store[key] as string) : null
    },
    setItem(key: string, value: string) {
      store[key] = value
    },
    removeItem(key: string) {
      delete store[key]
    },
    clear() {
      store = {}
    },
  }
}

const lsMock = makeLocalStorageMock()

function q(container: HTMLElement, selector: string): Element | null {
  return container.querySelector(selector)
}
function qa(container: HTMLElement, selector: string): NodeListOf<Element> {
  return container.querySelectorAll(selector)
}
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  initStore({ forceInProcess: true })
})

afterEach(() => {
  destroyStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Sample traffic', () => {
  it('seeds ~8 demo requests via the empty-state button, with a status/method mix and a slow one', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    expect(q(container, '.hakka-list-empty')).toBeTruthy()
    const sampleBtn = q(container, '.hakka-empty-sample-btn') as HTMLElement
    expect(sampleBtn).toBeTruthy()

    fireEvent.click(sampleBtn)
    await waitFor(() => qa(container, '.hakka-row').length > 0)

    const rows = qa(container, '.hakka-row')
    expect(rows.length).toBe(11)
    expect(q(container, '.hakka-list-empty')).toBeNull()

    // Assert on real rendered elements, never bare container.textContent —
    // textContent includes the CSS of any inline <style> descendant, and
    // styles.ts contains substrings like "500" (font-weight declarations)
    // that let a broken assertion pass by pure coincidence.
    const methodTexts = Array.from(qa(container, '.hakka-method-badge'), (el) => el.textContent)
    expect(methodTexts).toContain('GET')
    expect(methodTexts).toContain('POST')

    const statusEls = Array.from(qa(container, '.hakka-status'))
    const statusTexts = statusEls.map((el) => el.textContent)
    expect(statusTexts).toContain('404')
    // statusLabel is status-code-first: a request with an `error` field still
    // reads "500" in the error color, never a bare "ERR".
    const errBadges = statusEls.filter((el) => el.classList.contains('status-error'))
    expect(errBadges.length).toBeGreaterThanOrEqual(1)
    expect(errBadges.map((el) => el.textContent)).toContain('500')

    // Pin the 500 in the seeded data itself too, not just the rendered row.
    const seeded = buildSampleRequests()
    expect(seeded.some((r) => r.status === 500)).toBe(true)
    expect(seeded.some((r) => r.status === 404)).toBe(true)
  })

  it('Clear removes the seeded demo requests like any other captured traffic', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    fireEvent.click(q(container, '.hakka-empty-sample-btn') as HTMLElement)
    await waitFor(() => qa(container, '.hakka-row').length > 0)
    expect(qa(container, '.hakka-row').length).toBe(11)

    const clearBtn = Array.from(qa(container, '.hakka-btn')).find((b) => b.textContent === 'Clear') as HTMLElement
    expect(clearBtn).toBeTruthy()
    fireEvent.click(clearBtn)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(0)
    expect(q(container, '.hakka-list-empty')).toBeTruthy()
  })
})

describe('Tour (opt-in via command palette)', () => {
  /** Open the panel, open ⌘K, run "Show quick tour", wait for the overlay. */
  async function startTourViaPalette(container: HTMLElement): Promise<void> {
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()
    fireEvent.click(q(container, '.hakka-btn[title^="Command palette"]') as HTMLElement)
    // CommandPalette is a lazy chunk — wait for its items to resolve + render.
    await waitFor(() => qa(container, '.hakka-palette-item').length > 0, 3000)
    const item = Array.from(qa(container, '.hakka-palette-item')).find((el) =>
      /show quick tour/i.test(el.textContent ?? ''),
    ) as HTMLElement
    expect(item).toBeTruthy()
    fireEvent.click(item)
    await waitFor(() => q(container, '.hakka-tour-overlay') !== null, 3000)
  }

  it('never auto-shows — not even on a first open with tourSeen unset', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()
    // Give any (incorrectly surviving) deferred auto-start a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(q(container, '.hakka-tour-overlay')).toBeNull()
  })

  it('launches from the palette action and shows step 1 of 3', async () => {
    const { container } = render(() => <Inspector />)
    await startTourViaPalette(container)
    expect(q(container, '.hakka-tour-overlay')).toBeTruthy()
    expect(container.textContent).toContain('1 / 3')
  })

  it('Skip dismisses the tour and persists tourSeen', async () => {
    const { container } = render(() => <Inspector />)
    await startTourViaPalette(container)
    const skipBtn = Array.from(qa(container, 'button')).find((b) => /skip/i.test(b.textContent ?? '')) as HTMLElement
    expect(skipBtn).toBeTruthy()
    fireEvent.click(skipBtn)
    await flush()

    expect(q(container, '.hakka-tour-overlay')).toBeNull()
    expect(loadUiState().tourSeen).toBe(true)
  })

  it('stepping through Next reaches the final step and Done dismisses it', async () => {
    const { container } = render(() => <Inspector />)
    await startTourViaPalette(container)

    const clickNext = () => {
      const btn = Array.from(qa(container, 'button')).find((b) => /^(next|done)$/i.test(b.textContent ?? ''))
      fireEvent.click(btn as HTMLElement)
    }

    clickNext() // -> step 2
    await flush()
    clickNext() // -> step 3
    await flush()
    expect(container.textContent).toContain('3 / 3')

    clickNext() // Done
    await flush()
    expect(q(container, '.hakka-tour-overlay')).toBeNull()
    expect(loadUiState().tourSeen).toBe(true)
  })
})
