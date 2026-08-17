import { render, fireEvent } from '@solidjs/testing-library'
import { flush } from 'solid-js'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { disableConsoleMirror } from '../../consoleMirror'
import { disconnect } from '../../desktopBridge'
import { loadUiState, saveUiState, pushRecentFilter, addSavedFilter, removeSavedFilter } from '../persist'
import type { SavedFilter } from '../persist'
import { SettingsTab } from '../SettingsTab'

// happy-dom does not provide localStorage unless --localstorage-file is set —
// stub a minimal in-memory implementation.
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

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
})

afterEach(() => {
  disableConsoleMirror()
  disconnect()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('persist.ts — new settings fields', () => {
  it('loadUiState returns defaults for new fields when nothing stored', () => {
    const state = loadUiState()
    expect(state.logToConsole).toBe(false)
    expect(state.desktopConnect).toBe(false)
    expect(state.desktopUrl).toBe('ws://localhost:8989')
    expect(state.maxRecords).toBe(500)
  })

  it('persists logToConsole', () => {
    saveUiState({ logToConsole: true })
    expect(loadUiState().logToConsole).toBe(true)
  })

  it('persists desktopConnect', () => {
    saveUiState({ desktopConnect: true })
    expect(loadUiState().desktopConnect).toBe(true)
  })

  it('persists desktopUrl', () => {
    saveUiState({ desktopUrl: 'ws://127.0.0.1:9000' })
    expect(loadUiState().desktopUrl).toBe('ws://127.0.0.1:9000')
  })

  it('persists maxRecords', () => {
    saveUiState({ maxRecords: 200 })
    expect(loadUiState().maxRecords).toBe(200)
  })

  it('round-trips all new settings together', () => {
    saveUiState({
      logToConsole: true,
      desktopConnect: false,
      desktopUrl: 'ws://localhost:7777',
      maxRecords: 100,
    })
    const loaded = loadUiState()
    expect(loaded.logToConsole).toBe(true)
    expect(loaded.desktopConnect).toBe(false)
    expect(loaded.desktopUrl).toBe('ws://localhost:7777')
    expect(loaded.maxRecords).toBe(100)
  })

  it('ignores invalid types from corrupt JSON', () => {
    localStorage.setItem('hakka:ui', JSON.stringify({ logToConsole: 'yes', desktopUrl: 42, maxRecords: 'many' }))
    const state = loadUiState()
    expect(state.logToConsole).toBe(false) // 'yes' is not a boolean -> default
    expect(state.desktopUrl).toBe('ws://localhost:8989') // 42 is not a string -> default
    expect(state.maxRecords).toBe(500) // 'many' is not a number -> default
  })

  it('compactDensity defaults to false', () => {
    const state = loadUiState()
    expect(state.compactDensity).toBe(false)
  })

  it('persists compactDensity true', () => {
    saveUiState({ compactDensity: true })
    expect(loadUiState().compactDensity).toBe(true)
  })

  it('persists compactDensity false after toggling back', () => {
    saveUiState({ compactDensity: true })
    saveUiState({ compactDensity: false })
    expect(loadUiState().compactDensity).toBe(false)
  })

  it('compactDensity survives round-trip with other fields', () => {
    saveUiState({ compactDensity: true, maxRecords: 200 })
    const loaded = loadUiState()
    expect(loaded.compactDensity).toBe(true)
    expect(loaded.maxRecords).toBe(200)
  })
})

describe('persist.ts — theming fields', () => {
  it('defaults to navy preset, full opacity, and unset (0) panel height', () => {
    const state = loadUiState()
    expect(state.preset).toBe('navy')
    expect(state.panelOpacity).toBe(1)
    expect(state.panelHeightPx).toBe(0)
  })

  it('persists preset', () => {
    saveUiState({ preset: 'amber' })
    expect(loadUiState().preset).toBe('amber')
  })

  it('persists panelOpacity', () => {
    saveUiState({ panelOpacity: 0.6 })
    expect(loadUiState().panelOpacity).toBe(0.6)
  })

  it('persists panelHeightPx', () => {
    saveUiState({ panelHeightPx: 540 })
    expect(loadUiState().panelHeightPx).toBe(540)
  })

  it('ignores invalid types for the new theming fields, falling back to defaults', () => {
    localStorage.setItem('hakka:ui', JSON.stringify({ preset: 42, panelOpacity: 'high', panelHeightPx: 'tall' }))
    const state = loadUiState()
    expect(state.preset).toBe('navy')
    expect(state.panelOpacity).toBe(1)
    expect(state.panelHeightPx).toBe(0)
  })

  it('theming fields survive round-trip with unrelated fields', () => {
    saveUiState({ preset: 'matrix', panelOpacity: 0.7, panelHeightPx: 480, maxRecords: 250 })
    const loaded = loadUiState()
    expect(loaded.preset).toBe('matrix')
    expect(loaded.panelOpacity).toBe(0.7)
    expect(loaded.panelHeightPx).toBe(480)
    expect(loaded.maxRecords).toBe(250)
  })
})

describe('SettingsTab', () => {
  function q(container: HTMLElement, sel: string): Element | null {
    return container.querySelector(sel)
  }

  it('renders the URL input with default value', () => {
    const { container } = render(() => <SettingsTab />)
    const input = q(container, '[aria-label="Desktop WebSocket URL"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('ws://localhost:8989')
  })

  it('renders the max records input', () => {
    const { container } = render(() => <SettingsTab />)
    const input = q(container, '[aria-label="Max records"]') as HTMLInputElement
    expect(input).toBeTruthy()
    expect(input.value).toBe('500')
  })

  it('logToConsole toggle starts unpressed', () => {
    const { container } = render(() => <SettingsTab />)
    const btn = q(container, '[aria-label="Toggle log to console"]') as HTMLElement
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('clicking logToConsole toggle sets aria-pressed to true', async () => {
    const { container } = render(() => <SettingsTab />)
    const btn = q(container, '[aria-label="Toggle log to console"]') as HTMLElement
    fireEvent.click(btn)
    // Solid 2 microtask-batches signal writes — flush before asserting.
    await flush()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('clicking logToConsole toggle persists the enabled state', () => {
    const { container } = render(() => <SettingsTab />)
    const btn = q(container, '[aria-label="Toggle log to console"]') as HTMLElement
    fireEvent.click(btn)
    expect(loadUiState().logToConsole).toBe(true)
  })

  it('clicking logToConsole toggle again disables and persists false', async () => {
    const { container } = render(() => <SettingsTab />)
    const btn = q(container, '[aria-label="Toggle log to console"]') as HTMLElement
    fireEvent.click(btn)
    await flush()
    fireEvent.click(btn)
    await flush()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(loadUiState().logToConsole).toBe(false)
  })

  it('changing the URL input and blurring persists the new URL', () => {
    const { container } = render(() => <SettingsTab />)
    const input = q(container, '[aria-label="Desktop WebSocket URL"]') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'ws://127.0.0.1:9000' } })
    fireEvent.blur(input)
    expect(loadUiState().desktopUrl).toBe('ws://127.0.0.1:9000')
  })

  it('changing max records input persists the value', () => {
    const { container } = render(() => <SettingsTab />)
    const input = q(container, '[aria-label="Max records"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: '250' } })
    expect(loadUiState().maxRecords).toBe(250)
  })

  it('restores persisted URL and maxRecords on mount', () => {
    saveUiState({ desktopUrl: 'ws://192.168.1.1:8989', maxRecords: 300 })
    const { container } = render(() => <SettingsTab />)

    const urlInput = q(container, '[aria-label="Desktop WebSocket URL"]') as HTMLInputElement
    const maxInput = q(container, '[aria-label="Max records"]') as HTMLInputElement

    expect(urlInput.value).toBe('ws://192.168.1.1:8989')
    expect(maxInput.value).toBe('300')
  })

  it('theme preset select defaults to navy and lists all 6 curated presets', () => {
    const { container } = render(() => <SettingsTab />)
    const select = q(container, '[aria-label="Theme preset"]') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.value).toBe('navy')
    const options = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value)
    expect(options).toEqual(['navy', 'light', 'high-contrast', 'amber', 'matrix', 'paper'])
  })

  it('selecting a preset persists it', () => {
    const { container } = render(() => <SettingsTab />)
    const select = q(container, '[aria-label="Theme preset"]') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'amber' } })
    expect(loadUiState().preset).toBe('amber')
  })

  it('restores a persisted preset on mount', () => {
    saveUiState({ preset: 'matrix' })
    const { container } = render(() => <SettingsTab />)
    const select = q(container, '[aria-label="Theme preset"]') as HTMLSelectElement
    expect(select.value).toBe('matrix')
  })

  it('panel opacity slider defaults to 1 (fully opaque)', () => {
    const { container } = render(() => <SettingsTab />)
    const slider = q(container, '[aria-label="Panel opacity"]') as HTMLInputElement
    expect(slider).toBeTruthy()
    expect(Number(slider.value)).toBe(1)
  })

  it('changing panel opacity persists the clamped value', () => {
    const { container } = render(() => <SettingsTab />)
    const slider = q(container, '[aria-label="Panel opacity"]') as HTMLInputElement
    fireEvent.input(slider, { target: { value: '0.65' } })
    expect(loadUiState().panelOpacity).toBe(0.65)
  })

  it('restores a persisted panel opacity on mount', () => {
    saveUiState({ panelOpacity: 0.55 })
    const { container } = render(() => <SettingsTab />)
    const slider = q(container, '[aria-label="Panel opacity"]') as HTMLInputElement
    expect(Number(slider.value)).toBe(0.55)
  })
})

const baseFilter: SavedFilter = {
  filterText: 'api',
  filterMethod: 'GET',
  filterStatus: '2xx',
  filterContentType: 'json',
  filterRuntime: 'all',
  sortField: 'duration',
  sortOrder: 'asc',
  groupBy: 'host',
}

describe('persist.ts — savedFilters', () => {
  it('defaults to empty savedFilters', () => {
    expect(loadUiState().savedFilters).toEqual([])
  })

  it('addSavedFilter stores a named entry', () => {
    addSavedFilter('my-filter', baseFilter)
    const { savedFilters } = loadUiState()
    expect(savedFilters.length).toBe(1)
    expect(savedFilters[0]!.name).toBe('my-filter')
    expect(savedFilters[0]!.query.filterText).toBe('api')
  })

  it('addSavedFilter overwrites same name', () => {
    addSavedFilter('dup', baseFilter)
    addSavedFilter('dup', { ...baseFilter, filterText: 'users' })
    const { savedFilters } = loadUiState()
    expect(savedFilters.length).toBe(1)
    expect(savedFilters[0]!.query.filterText).toBe('users')
  })

  it('removeSavedFilter deletes by name', () => {
    addSavedFilter('to-remove', baseFilter)
    addSavedFilter('keep', baseFilter)
    removeSavedFilter('to-remove')
    const { savedFilters } = loadUiState()
    expect(savedFilters.find((sf) => sf.name === 'to-remove')).toBeUndefined()
    expect(savedFilters.find((sf) => sf.name === 'keep')).toBeTruthy()
  })

  it('round-trips savedFilters through saveUiState/loadUiState', () => {
    saveUiState({ savedFilters: [{ name: 'rt', query: baseFilter }] })
    const { savedFilters } = loadUiState()
    expect(savedFilters[0]!.query).toEqual(baseFilter)
  })
})

describe('persist.ts — recentFilters', () => {
  it('defaults to empty recentFilters', () => {
    expect(loadUiState().recentFilters).toEqual([])
  })

  it('pushRecentFilter adds entry at the front', () => {
    pushRecentFilter(baseFilter)
    const { recentFilters } = loadUiState()
    expect(recentFilters[0]!.filterText).toBe('api')
  })

  it('pushRecentFilter ignores empty filterText', () => {
    pushRecentFilter({ ...baseFilter, filterText: '' })
    expect(loadUiState().recentFilters.length).toBe(0)
  })

  it('pushRecentFilter dedupes by filterText (moves to front)', () => {
    pushRecentFilter(baseFilter)
    pushRecentFilter({ ...baseFilter, filterText: 'orders' })
    pushRecentFilter(baseFilter) // 'api' again → dedupe
    const { recentFilters } = loadUiState()
    expect(recentFilters[0]!.filterText).toBe('api')
    // 'orders' is now 2nd (not duplicated)
    expect(recentFilters.length).toBe(2)
  })

  it('caps recentFilters at 8 entries', () => {
    for (let i = 0; i < 12; i++) {
      pushRecentFilter({ ...baseFilter, filterText: `query-${i}` })
    }
    expect(loadUiState().recentFilters.length).toBe(8)
  })

  it('round-trips recentFilters through saveUiState/loadUiState', () => {
    saveUiState({ recentFilters: [baseFilter] })
    const { recentFilters } = loadUiState()
    expect(recentFilters[0]).toEqual(baseFilter)
  })
})
