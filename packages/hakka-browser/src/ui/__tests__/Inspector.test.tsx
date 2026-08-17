import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { createStoreClient } from '../../worker/storeClient'
import { Inspector } from '../Inspector'
import { saveUiState } from '../persist'

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    endTime: Date.now() + 100,
    duration: 100,
    requestHeaders: { accept: 'application/json' },
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"ok":true}',
    responseBodySize: 10,
    ...overrides,
  }
}

function q(container: HTMLElement, selector: string): Element | null {
  return container.querySelector(selector)
}

function qa(container: HTMLElement, selector: string): NodeListOf<Element> {
  return container.querySelectorAll(selector)
}

// Flush the async store snapshot + Solid reactive updates.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// The store runs in a Worker in production; tests force the identical
// in-process backend so seeding and assertions stay deterministic.
let client: StoreClient

beforeEach(() => {
  client = initStore({ forceInProcess: true })
})

afterEach(() => {
  destroyStore()
  vi.restoreAllMocks()
})

describe('Inspector', () => {
  it('panel is initially closed', () => {
    const { container } = render(() => <Inspector />)
    const panel = q(container, '.hakka-panel')
    expect(panel?.classList.contains('open')).toBe(false)
  })

  it('opens the full panel on right-click (contextmenu) of the toggle', async () => {
    const { container } = render(() => <Inspector />)
    const btn = q(container, '.hakka-toggle') as HTMLElement
    fireEvent.contextMenu(btn)
    await flush()
    const panel = q(container, '.hakka-panel')
    expect(panel?.classList.contains('open')).toBe(true)
  })

  it('dragging the toggle past the threshold cancels the pending long-press, so releasing never opens the panel', () => {
    vi.useFakeTimers()
    const { container } = render(() => <Inspector />)
    const btn = q(container, '.hakka-toggle') as HTMLElement

    fireEvent.pointerDown(btn, { pointerId: 1, clientX: 100, clientY: 100 })
    // Cross the 10px drag threshold well before the 450ms long-press fires.
    fireEvent.pointerMove(btn, { pointerId: 1, clientX: 130, clientY: 100 })
    // Advance past the long-press window — if the drag hadn't cancelled the
    // timer, this would open the panel on its own.
    vi.advanceTimersByTime(500)
    fireEvent.pointerUp(btn, { pointerId: 1, clientX: 130, clientY: 100 })

    const panel = q(container, '.hakka-panel')
    expect(panel?.classList.contains('open')).toBe(false)

    vi.useRealTimers()
  })

  it('shows request count badge when there are requests', async () => {
    const req = makeRequest()
    client.ingest(req)
    const { container } = render(() => <Inspector />)
    await flush()
    const badge = q(container, '.hakka-badge')
    expect(badge?.textContent).toBe('1')
  })

  it('shows request in list after opening panel', async () => {
    const req = makeRequest({ url: 'https://api.example.com/items', method: 'POST' })
    client.ingest(req)
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const path = q(container, '.hakka-row-path')
    expect(path?.textContent).toContain('/items')
  })

  it('clicking a row shows the detail view', async () => {
    const req = makeRequest({ url: 'https://api.example.com/orders' })
    client.ingest(req)
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const row = q(container, '.hakka-row') as HTMLElement
    expect(row).toBeTruthy()
    fireEvent.click(row)
    await flush()

    const backBtn = q(container, '.hakka-back-btn')
    expect(backBtn?.getAttribute('aria-label')).toBe('Back to request list')
  })

  it('back button returns to list', async () => {
    const req = makeRequest()
    client.ingest(req)
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()
    fireEvent.click(q(container, '.hakka-row') as HTMLElement)
    await flush()
    fireEvent.click(q(container, '.hakka-back-btn') as HTMLElement)
    await flush()

    const list = q(container, '.hakka-list')
    expect(list).toBeTruthy()
  })

  it('filter input narrows the list', async () => {
    client.ingest(makeRequest({ url: 'https://api.example.com/users', id: 'r1' }))
    client.ingest(makeRequest({ url: 'https://api.example.com/orders', id: 'r2' }))
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(2)

    const input = q(container, '.hakka-search') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'orders' } })
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(1)
    expect(q(container, '.hakka-row-path')?.textContent).toContain('/orders')
  })

  it('clear button removes all requests', async () => {
    client.ingest(makeRequest({ id: 'r1' }))
    client.ingest(makeRequest({ id: 'r2' }))
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()
    expect(qa(container, '.hakka-row').length).toBe(2)

    const clearBtn = Array.from(qa(container, '.hakka-btn')).find((b) => b.textContent === 'Clear') as HTMLElement
    fireEvent.click(clearBtn)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(0)
  })

  it('shows a runtime badge + runtime filter for server captures', async () => {
    client.ingest(makeRequest({ id: 'c', url: 'https://x.com/client' }))
    client.ingest(makeRequest({ id: 's', url: 'https://x.com/server', runtime: 'server' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    expect(container.querySelector('.hakka-rt-server')).toBeTruthy()

    const serverBtn = Array.from(container.querySelectorAll('.hakka-filter-cluster .hakka-chip')).find(
      (b) => b.textContent?.trim() === 'Server',
    ) as HTMLElement
    expect(serverBtn).toBeTruthy()

    fireEvent.click(serverBtn)
    await flush()
    expect(qa(container, '.hakka-row').length).toBe(1)
    expect(q(container, '.hakka-row-path')?.textContent).toContain('/server')
  })
})

describe('Inspector multi-select', () => {
  it('clicking Select chip enters select mode and shows checkboxes', async () => {
    client.ingest(makeRequest({ id: 'ms-1' }))
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const selectBtn = q(container, '.hakka-select-mode-btn') as HTMLElement
    expect(selectBtn).toBeTruthy()
    fireEvent.click(selectBtn)
    await flush()

    expect(qa(container, '.hakka-row-checkbox').length).toBeGreaterThan(0)
  })

  it('clicking a row in select mode toggles its checkbox', async () => {
    client.ingest(makeRequest({ id: 'ms-2' }))
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    fireEvent.click(q(container, '.hakka-select-mode-btn') as HTMLElement)
    await flush()

    const row = q(container, '.hakka-row') as HTMLElement
    fireEvent.click(row)
    await flush()

    const checkbox = q(container, '.hakka-row-checkbox.checked')
    expect(checkbox).toBeTruthy()
  })

  it('action bar appears when items are selected', async () => {
    client.ingest(makeRequest({ id: 'ms-3' }))
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    fireEvent.click(q(container, '.hakka-select-mode-btn') as HTMLElement)
    await flush()
    fireEvent.click(q(container, '.hakka-row') as HTMLElement)
    await flush()

    const actionBar = q(container, '.hakka-action-bar')
    expect(actionBar).toBeTruthy()
    expect(actionBar?.textContent).toContain('1 selected')
  })

  it('cancel button exits select mode and hides action bar', async () => {
    client.ingest(makeRequest({ id: 'ms-4' }))
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    fireEvent.click(q(container, '.hakka-select-mode-btn') as HTMLElement)
    await flush()
    fireEvent.click(q(container, '.hakka-row') as HTMLElement)
    await flush()

    const cancelBtn = q(container, '.hakka-action-cancel') as HTMLElement
    fireEvent.click(cancelBtn)
    await flush()

    expect(q(container, '.hakka-action-bar')).toBeNull()
    expect(q(container, '.hakka-row-checkbox')).toBeNull()
  })
})

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

describe('Inspector saved + recent filters', () => {
  const lsMock = makeLocalStorageMock()

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

  it('shows saved filter chip after saving a filter', async () => {
    // Seed localStorage before mount so Inspector picks it up on load.
    saveUiState({
      savedFilters: [
        {
          name: 'my-preset',
          query: {
            filterText: 'api',
            filterMethod: 'GET',
            filterStatus: 'all',
            filterContentType: 'all',
            filterRuntime: 'all',
            sortField: 'time',
            sortOrder: 'desc',
            groupBy: 'none',
          },
        },
      ],
    })

    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const chip = Array.from(container.querySelectorAll('.hakka-saved-chip')).find(
      (el) => el.textContent?.trim() === 'my-preset',
    )
    expect(chip).toBeTruthy()
  })

  it('applying a saved filter sets the search input value', async () => {
    saveUiState({
      savedFilters: [
        {
          name: 'search-preset',
          query: {
            filterText: 'users',
            filterMethod: '',
            filterStatus: 'all',
            filterContentType: 'all',
            filterRuntime: 'all',
            sortField: 'time',
            sortOrder: 'desc',
            groupBy: 'none',
          },
        },
      ],
    })

    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const chip = Array.from(container.querySelectorAll('.hakka-saved-chip')).find(
      (el) => el.textContent?.trim() === 'search-preset',
    ) as HTMLElement
    expect(chip).toBeTruthy()
    fireEvent.click(chip)
    await flush()

    const searchInput = q(container, '.hakka-search') as HTMLInputElement
    expect(searchInput.value).toBe('users')
  })

  it('recent filter chips stay hidden while a query is live, then recall it once cleared', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const searchInput = q(container, '.hakka-search') as HTMLInputElement
    fireEvent.input(searchInput, { target: { value: 'orders' } })
    await flush()

    // While the query sits in the box, a chip echoing it back is noise.
    const liveEcho = Array.from(container.querySelectorAll('.hakka-recent-chip')).find(
      (el) => el.textContent?.trim() === 'orders',
    )
    expect(liveEcho).toBeFalsy()

    fireEvent.input(searchInput, { target: { value: '' } })
    await flush()

    // Empty box is the recall moment — now the recent chip earns its row.
    const recalled = Array.from(container.querySelectorAll('.hakka-recent-chip')).find(
      (el) => el.textContent?.trim() === 'orders',
    )
    expect(recalled).toBeTruthy()
  })
})

// These tests use createStoreClient directly: the initStore re-export via
// worker/index is shadowed by the top-level worker.ts in this env.
describe('Inspector search autocomplete suggestions', () => {
  const lsMock = makeLocalStorageMock()
  let sugClient: ReturnType<typeof createStoreClient>

  beforeEach(() => {
    vi.stubGlobal('localStorage', lsMock)
    lsMock.clear()
    sugClient = createStoreClient({ forceInProcess: true })
  })

  afterEach(() => {
    sugClient.destroy()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('datalist scope hints appear when the panel is open and input is empty', async () => {
    // Seed a recent filter so the suggestion list is non-empty even without logs.
    saveUiState({
      recentFilters: [
        {
          filterText: 'myapi.example.com',
          filterMethod: '',
          filterStatus: 'all',
          filterContentType: 'all',
          filterRuntime: 'all',
          sortField: 'time',
          sortOrder: 'desc',
          groupBy: 'none',
        },
      ],
    })

    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const datalist = container.querySelector('#hakka-search-suggestions')
    expect(datalist).toBeTruthy()
    const options = Array.from(datalist!.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value)
    expect(options.some((o) => o === 'myapi.example.com')).toBe(true)
    expect(options.some((o) => o === 'host:')).toBe(true)
  })

  it('datalist includes a recent filter text after typing in the search box', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    // Typing pushes the value into recent filters via createEffect.
    const searchInput = q(container, '.hakka-search') as HTMLInputElement
    fireEvent.input(searchInput, { target: { value: 'payments' } })
    await flush()

    // Clear the input so the datalist renders the full suggestion list.
    fireEvent.input(searchInput, { target: { value: '' } })
    await flush()

    const datalist = container.querySelector('#hakka-search-suggestions')
    expect(datalist).toBeTruthy()
    const options = Array.from(datalist!.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value)
    expect(options.some((o) => o === 'payments')).toBe(true)
  })
})
