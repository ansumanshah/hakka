import { render, fireEvent } from '@solidjs/testing-library'
import { Hakka } from 'hakka-core'
import type { NetworkRequest } from 'hakka-core'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { getSystemInfo } from '../../adapters/deviceInfo'
import { readStorage } from '../../adapters/storage'
import { enableConsoleCapture, getConsoleEntries, clearConsole } from '../../capture/console'
import { initStore, destroyStore, type StoreClient } from '../../worker'
import { BodySearch } from '../Detail'
import { Inspector } from '../Inspector'

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

// Poll until `fn` stops throwing — used to await a lazy() panel/JsonViewer chunk
// resolving through its Suspense boundary before asserting on its rendered DOM.
async function waitFor<T>(fn: () => T, timeout = 2000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      return fn()
    } catch (e) {
      if (Date.now() > deadline) throw e
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

let client: StoreClient

beforeEach(() => {
  client = initStore({ forceInProcess: true })
  clearConsole()
})

afterEach(() => {
  destroyStore()
  vi.restoreAllMocks()
})

describe('Inspector tab bar', () => {
  it('Network tab is active by default', () => {
    const { container } = render(() => <Inspector />)
    const tabs = qa(container, '.hakka-tab')
    const networkTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Network')
    expect(networkTab?.classList.contains('active')).toBe(true)
  })

  it('clicking Console tab switches to console view', async () => {
    const { container } = render(() => <Inspector />)

    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const tabs = qa(container, '.hakka-tab')
    const consoleTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Logs') as HTMLElement
    expect(consoleTab).toBeTruthy()
    fireEvent.click(consoleTab)
    await flush()

    expect(consoleTab.classList.contains('active')).toBe(true)
    expect(q(container, '.hakka-list')).toBeNull()
  })

  it('clicking Storage tab switches to storage view', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const tabs = qa(container, '.hakka-tab')
    const storageTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Storage') as HTMLElement
    fireEvent.click(storageTab)
    await flush()

    expect(storageTab.classList.contains('active')).toBe(true)
    expect(q(container, '.hakka-list')).toBeNull()
  })

  it('clicking Settings tab shows the environment kv-table (absorbed Info panel)', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const tabs = qa(container, '.hakka-tab')
    const settingsTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Settings') as HTMLElement
    fireEvent.click(settingsTab)
    await flush()

    expect(settingsTab.classList.contains('active')).toBe(true)
    // Settings is a lazy() chunk — wait for it before checking the merged Info panel's kv-table.
    await waitFor(() => expect(q(container, '.hakka-kv-table')).toBeTruthy())
  })

  it('switching back to Network tab shows the request list', async () => {
    client.ingest(makeRequest({ url: 'https://api.example.com/foo', id: 'tab-back-test' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const tabs = qa(container, '.hakka-tab')
    const consoleTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Logs') as HTMLElement
    const networkTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Network') as HTMLElement

    fireEvent.click(consoleTab)
    await flush()
    expect(q(container, '.hakka-list')).toBeNull()

    fireEvent.click(networkTab)
    await flush()
    expect(q(container, '.hakka-list')).toBeTruthy()
  })

  it('scrolls the newly active header tab into view, same guarantee as Detail’s secondary strip', async () => {
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()
    spy.mockClear() // ignore the mount-time call for the default 'network' tab

    const tabs = qa(container, '.hakka-tab')
    const storageTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Storage') as HTMLElement
    fireEvent.click(storageTab)
    await flush()

    expect(spy).toHaveBeenCalled()
    expect(spy.mock.instances).toContain(storageTab)
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ inline: 'nearest' }))
  })
})

describe('Status-code chip filter', () => {
  it('4xx chip hides 2xx responses', async () => {
    client.ingest(makeRequest({ url: 'https://a.com/ok', status: 200, id: 'chip-200' }))
    client.ingest(makeRequest({ url: 'https://a.com/err', status: 404, id: 'chip-404' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(2)

    const chips = Array.from(qa(container, '.hakka-chip'))
    const chip4xx = chips.find((c) => c.textContent?.trim() === '4xx') as HTMLElement
    expect(chip4xx).toBeTruthy()
    fireEvent.click(chip4xx)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(1)
  })

  it('2xx chip shows only 2xx responses', async () => {
    client.ingest(makeRequest({ url: 'https://a.com/ok', status: 201, id: 'chip-201' }))
    client.ingest(makeRequest({ url: 'https://a.com/err', status: 500, id: 'chip-500' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const chips = Array.from(qa(container, '.hakka-chip'))
    const chip2xx = chips.find((c) => c.textContent?.trim() === '2xx') as HTMLElement
    fireEvent.click(chip2xx)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(1)
  })
})

describe('Console capture', () => {
  it('enableConsoleCapture buffers entries and returns teardown', () => {
    const teardown = enableConsoleCapture()
    expect(typeof teardown).toBe('function')

    // eslint-disable-next-line no-console
    console.log('hello from test')
    const entries = getConsoleEntries()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[entries.length - 1]!.message).toContain('hello from test')

    teardown()
  })

  it('collapses consecutive identical messages into one entry with count', () => {
    clearConsole()
    const teardown = enableConsoleCapture()

    // eslint-disable-next-line no-console
    console.warn('repeat!')
    // eslint-disable-next-line no-console
    console.warn('repeat!')
    // eslint-disable-next-line no-console
    console.warn('repeat!')

    const entries = getConsoleEntries()
    const repeatEntry = entries.find((e) => e.message === 'repeat!')
    expect(repeatEntry).toBeTruthy()
    expect(repeatEntry?.count).toBe(3)

    teardown()
  })

  it('does not collapse messages of different levels', () => {
    clearConsole()
    const teardown = enableConsoleCapture()

    // eslint-disable-next-line no-console
    console.log('same msg')
    // eslint-disable-next-line no-console
    console.warn('same msg')

    const entries = getConsoleEntries()
    const matching = entries.filter((e) => e.message === 'same msg')
    expect(matching.length).toBe(2)
    expect(matching[0]!.count).toBe(1)
    expect(matching[1]!.count).toBe(1)

    teardown()
  })

  it('error count badge appears in Console tab', () => {
    clearConsole()
    const teardown = enableConsoleCapture()

    // eslint-disable-next-line no-console
    console.error('boom')

    const { container } = render(() => <Inspector />)

    const tabs = qa(container, '.hakka-tab')
    const consoleTab = Array.from(tabs).find((t) => t.textContent?.includes('Logs'))
    expect(consoleTab?.textContent).toMatch(/\d+/)

    teardown()
  })

  it('clearConsole empties the buffer', () => {
    const teardown = enableConsoleCapture()
    // eslint-disable-next-line no-console
    console.log('test')
    clearConsole()
    expect(getConsoleEntries().length).toBe(0)
    teardown()
  })
})

describe('Storage adapter', () => {
  it('readStorage excludes keys prefixed with hakka:', () => {
    // happy-dom may not allow writes here; this just verifies the filtering
    // logic never lets a hakka: key through when writes do land.
    try {
      localStorage.setItem('hakka:ui', '{}')
      localStorage.setItem('hakka:test', 'internal')
      localStorage.setItem('user-pref', 'dark')
    } catch {
      // not writable in this environment
    }

    const snap = readStorage()
    const hasHakkaKey = snap.local.some((kv) => kv.key.startsWith('hakka:'))
    expect(hasHakkaKey).toBe(false)
  })
})

describe('Info tab', () => {
  it('getSystemInfo returns expected labels', () => {
    const rows = getSystemInfo()
    const labels = rows.map((r) => r.label)
    expect(labels).toContain('User Agent')
    expect(labels).toContain('Language')
    expect(labels).toContain('Viewport')
    expect(labels).toContain('Online')
    expect(labels).toContain('URL')
  })

  it('Settings tab renders a table with system rows', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)

    const tabs = qa(container, '.hakka-tab')
    const infoTab = Array.from(tabs).find((t) => t.textContent?.trim() === 'Settings') as HTMLElement
    fireEvent.click(infoTab)

    // Settings is lazy — wait for the chunk before checking the kv table + a system row.
    const table = await waitFor(() => {
      const t = q(container, '.hakka-kv-table')
      expect(t).toBeTruthy()
      return t
    })
    expect(table?.textContent ?? '').toContain('User Agent')
  })
})

describe('Panel registry', () => {
  it('panels are ordered by the order field (network first)', () => {
    const panels = Hakka.getPanels()
    const networkIdx = panels.findIndex((p) => p.id === 'network')
    const consoleIdx = panels.findIndex((p) => p.id === 'console')
    expect(networkIdx).toBeLessThan(consoleIdx)
  })

  it('Inspector tab bar reflects panels from Hakka.getPanels()', () => {
    const { container } = render(() => <Inspector />)
    const panels = Hakka.getPanels()
    const tabs = qa(container, '.hakka-tab')
    const tabIds = Array.from(tabs).map((t) => t.textContent?.trim() ?? '')
    for (const panel of panels) {
      expect(tabIds.some((text) => text.startsWith(panel.title))).toBe(true)
    }
  })
})

describe('BodySearch', () => {
  // The query signal is debounced ~120ms behind the input, so post-input
  // assertions must waitFor the debounced value instead of reading synchronously.

  it('shows no match indicator when query has no results', async () => {
    const { container } = render(() => <BodySearch text="hello world" />)
    const input = container.querySelector('.hakka-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'xyz_notfound' } })
    await waitFor(() => expect(container.textContent).toContain('No matches'))
  })

  it('shows n/m counter when matches are found', async () => {
    const { container } = render(() => <BodySearch text="foo bar foo" />)
    const input = container.querySelector('.hakka-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'foo' } })
    // Counter format: "1/2" (1 of 2 matches)
    await waitFor(() => expect(container.textContent).toMatch(/1\/2/))
  })

  it('next button advances the active match index', async () => {
    const { container } = render(() => <BodySearch text="aaa bbb aaa" />)
    const input = container.querySelector('.hakka-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'aaa' } })
    await waitFor(() => expect(container.textContent).toMatch(/1\/2/))
    const nextBtn = container.querySelector('.hakka-btn[title^="Next match"]') as HTMLElement
    expect(nextBtn).toBeTruthy()
    fireEvent.click(nextBtn)
    await waitFor(() => expect(container.textContent).toMatch(/2\/2/))
  })

  it('prev button wraps around to last match', async () => {
    const { container } = render(() => <BodySearch text="aaa bbb aaa" />)
    const input = container.querySelector('.hakka-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'aaa' } })
    // prev/next buttons only exist once the counter renders, so wait for that first.
    await waitFor(() => expect(container.textContent).toMatch(/1\/2/))
    const prevBtn = container.querySelector('.hakka-btn[title^="Previous match"]') as HTMLElement
    expect(prevBtn).toBeTruthy()
    fireEvent.click(prevBtn)
    await waitFor(() => expect(container.textContent).toMatch(/2\/2/))
  })

  it('renders mark elements to highlight matches', async () => {
    const { container } = render(() => <BodySearch text="hello world hello" />)
    const input = container.querySelector('.hakka-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'hello' } })
    await waitFor(() => expect(container.querySelectorAll('mark').length).toBe(2))
  })

  it('falls back to JsonViewer when query is empty', async () => {
    const jsonBody = '{"key":"value"}'
    const { container } = render(() => <BodySearch text={jsonBody} />)
    // JsonViewer is lazy — the raw-text <pre> fallback shows first, so wait for
    // the real viewer (hakka-json) to resolve through Suspense.
    await waitFor(() => expect(container.querySelector('.hakka-json')).toBeTruthy())
  })
})
