import { render, fireEvent } from '@solidjs/testing-library'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { Inspector } from '../Inspector'
import { loadUiState } from '../persist'
import { MIN_PANEL_HEIGHT_PX } from '../presets'

// Preset switching + panel opacity are covered in presets.test.ts (application)
// and settings.test.tsx (the Settings UI that drives them). Embed mode is
// covered in mount.test.tsx.

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

function qa(container: HTMLElement, selector: string): Element[] {
  return Array.from(container.querySelectorAll(selector))
}

// Flush the async store snapshot + Solid reactive updates.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let client: StoreClient

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  client = initStore({ forceInProcess: true })
})

afterEach(() => {
  destroyStore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Inspector — panel resize handle', () => {
  it('renders a resize handle (role=separator) in the floating panel', () => {
    const { container } = render(() => <Inspector />)
    const handle = q(container, '.hakka-resize-handle')
    expect(handle).toBeTruthy()
    expect(handle?.getAttribute('role')).toBe('separator')
    expect(handle?.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('embedded mode has no resize handle (nothing of ours to resize)', () => {
    const { container } = render(() => <Inspector embedded />)
    expect(q(container, '.hakka-resize-handle')).toBeNull()
  })

  it('dragging the handle persists the new panel height and applies the CSS var', () => {
    const { container } = render(() => <Inspector />)
    const handle = q(container, '.hakka-resize-handle') as HTMLElement

    expect(loadUiState().panelHeightPx).toBe(0) // unset by default

    // happy-dom has no layout engine (getBoundingClientRect is always zero),
    // so the resize baseline starts at 0 — dragging up 300px (start below,
    // move above) yields a 300px-tall panel.
    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(window, { clientY: 200 })
    fireEvent.mouseUp(window)

    expect(loadUiState().panelHeightPx).toBe(300)
    expect(container.style.getPropertyValue('--hakka-panel-height')).toBe('300px')
  })

  it('dragging below the minimum clamps to MIN_PANEL_HEIGHT_PX', () => {
    const { container } = render(() => <Inspector />)
    const handle = q(container, '.hakka-resize-handle') as HTMLElement

    fireEvent.mouseDown(handle, { clientY: 250 })
    fireEvent.mouseMove(window, { clientY: 200 }) // only a 50px drag
    fireEvent.mouseUp(window)

    expect(loadUiState().panelHeightPx).toBe(MIN_PANEL_HEIGHT_PX)
  })

  it('mousemove after mouseup no longer resizes (listeners are torn down)', () => {
    const { container } = render(() => <Inspector />)
    const handle = q(container, '.hakka-resize-handle') as HTMLElement

    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(window, { clientY: 200 })
    fireEvent.mouseUp(window)
    const afterFirstDrag = loadUiState().panelHeightPx

    fireEvent.mouseMove(window, { clientY: 50 }) // no mousedown first — should be ignored
    expect(loadUiState().panelHeightPx).toBe(afterFirstDrag)
  })

  it('Arrow Up/Down on the focused handle resizes in fixed steps', () => {
    const { container } = render(() => <Inspector />)
    const handle = q(container, '.hakka-resize-handle') as HTMLElement
    const defaultHeightPx = Math.round(window.innerHeight * 0.8)

    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(loadUiState().panelHeightPx).toBe(defaultHeightPx + 24)

    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(loadUiState().panelHeightPx).toBe(defaultHeightPx)
  })
})

describe('Inspector — mobile expand grip', () => {
  it('toggles .mobile-full on the panel, and resets it when the panel closes', async () => {
    const { container } = render(() => <Inspector />)
    const panel = q(container, '.hakka-panel') as HTMLElement
    const grip = q(container, '.hakka-mobile-grip') as HTMLElement
    expect(grip).toBeTruthy()
    expect(panel.classList.contains('mobile-full')).toBe(false)

    fireEvent.click(grip)
    await flush()
    expect(panel.classList.contains('mobile-full')).toBe(true)
    expect(grip.getAttribute('aria-pressed')).toBe('true')

    // Escalation is per-session, not sticky — closing the panel resets it so
    // the next open starts partial again (MOBILE-LAYOUT-SPEC.md §0).
    fireEvent.click(q(container, '.hakka-btn-close') as HTMLElement)
    await flush()
    expect(panel.classList.contains('mobile-full')).toBe(false)
  })

  it('embedded mode has no mobile grip (nothing of ours to expand)', () => {
    const { container } = render(() => <Inspector embedded />)
    expect(q(container, '.hakka-mobile-grip')).toBeNull()
  })
})

describe('Inspector — compact density toggle', () => {
  it('defaults to comfortable density', () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    expect(q(container, '.hakka-list')?.classList.contains('compact')).toBe(false)
  })

  it('clicking the density button applies .compact to the list and persists it', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)

    const densityBtn = qa(container, '.hakka-density-btn')[0] as HTMLElement
    expect(densityBtn).toBeTruthy()
    fireEvent.click(densityBtn)
    await flush()

    expect(q(container, '.hakka-list')?.classList.contains('compact')).toBe(true)
    expect(densityBtn.classList.contains('active')).toBe(true)
    expect(loadUiState().compactDensity).toBe(true)
  })

  it('clicking again restores comfortable density', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)

    const densityBtn = qa(container, '.hakka-density-btn')[0] as HTMLElement
    fireEvent.click(densityBtn)
    await flush()
    fireEvent.click(densityBtn)
    await flush()

    expect(q(container, '.hakka-list')?.classList.contains('compact')).toBe(false)
    expect(loadUiState().compactDensity).toBe(false)
  })

  it('restores a persisted compact density on mount', () => {
    client.ingest({
      id: 'r1',
      url: 'https://api.example.com/a',
      method: 'GET',
      status: 200,
      startTime: Date.now(),
      endTime: Date.now() + 10,
      duration: 10,
      requestHeaders: {},
      responseHeaders: {},
    })
    localStorage.setItem('hakka:ui', JSON.stringify({ compactDensity: true, open: true }))
    const { container } = render(() => <Inspector />)
    expect(q(container, '.hakka-list')?.classList.contains('compact')).toBe(true)
  })
})
