import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { deserializeReproBundle, serializeSession } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { Detail } from '../Detail'
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
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

let client: StoreClient

beforeEach(() => {
  client = initStore({ forceInProcess: true })
})

afterEach(() => {
  destroyStore()
  vi.restoreAllMocks()
})

describe('Command palette', () => {
  it('opens via the header button, filters by fuzzy match, and runs an action', async () => {
    client.ingest(makeRequest())
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const paletteBtn = Array.from(qa(container, '.hakka-btn')).find((b) => b.textContent?.includes('⌘K')) as HTMLElement
    expect(paletteBtn).toBeTruthy()
    fireEvent.click(paletteBtn)

    await waitFor(() => q(container, '.hakka-palette-input') !== null)
    expect(q(container, '.hakka-palette-overlay')).toBeTruthy()

    const input = q(container, '.hakka-palette-input') as HTMLInputElement
    fireEvent.input(input, { target: { value: 'clear' } })
    await flush()

    const items = qa(container, '.hakka-palette-item')
    expect(items.length).toBeGreaterThan(0)
    expect(Array.from(items).some((i) => /clear/i.test(i.textContent ?? ''))).toBe(true)

    fireEvent.click(items[0] as HTMLElement)
    await waitFor(() => q(container, '.hakka-palette-overlay') === null)
    expect(q(container, '.hakka-palette-overlay')).toBeNull()
  })

  it('Escape closes the palette without applying a filter', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const paletteBtn = Array.from(qa(container, '.hakka-btn')).find((b) => b.textContent?.includes('⌘K')) as HTMLElement
    fireEvent.click(paletteBtn)
    await waitFor(() => q(container, '.hakka-palette-input') !== null)

    const input = q(container, '.hakka-palette-input') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => q(container, '.hakka-palette-overlay') === null)
    expect(q(container, '.hakka-palette-overlay')).toBeNull()
  })
})

describe('Keyboard shortcuts', () => {
  it('"/" focuses the search input', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const search = q(container, '.hakka-search') as HTMLInputElement
    expect(search).toBeTruthy()
    expect(document.activeElement).not.toBe(search)

    fireEvent.keyDown(window, { key: '/' })
    expect(document.activeElement).toBe(search)
  })

  it('j/k moves the row selection and Enter opens the selected request', async () => {
    client.ingest(makeRequest({ id: 'kb-1', url: 'https://api.example.com/a' }))
    client.ingest(makeRequest({ id: 'kb-2', url: 'https://api.example.com/b' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(2)

    fireEvent.keyDown(window, { key: 'j' })
    await flush()
    expect(q(container, '.hakka-row.selected')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Enter' })
    await flush()
    expect(q(container, '.hakka-back-btn')).toBeTruthy()
  })

  it('Escape closes the detail view', async () => {
    client.ingest(makeRequest({ id: 'kb-esc' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()
    fireEvent.click(q(container, '.hakka-row') as HTMLElement)
    await flush()
    expect(q(container, '.hakka-back-btn')).toBeTruthy()

    fireEvent.keyDown(window, { key: 'Escape' })
    await flush()
    expect(q(container, '.hakka-back-btn')).toBeNull()
  })

  it('does not steal "/" while typing in an input', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const search = q(container, '.hakka-search') as HTMLInputElement
    search.focus()
    fireEvent.keyDown(search, { key: '/' })
    expect(document.activeElement).toBe(search)
  })
})

describe('Detail — Copy as menu', () => {
  it('lists cURL, fetch, axios, HTTPie, Python, and MSW handler options', () => {
    const req = makeRequest({ requestBody: '{"a":1}' })
    const { container } = render(() => <Detail req={req} onBack={() => {}} />)

    const summary = Array.from(container.querySelectorAll('summary')).find((s) => /copy as/i.test(s.textContent ?? ''))
    expect(summary).toBeTruthy()

    const menuButtons = Array.from(container.querySelectorAll('.hakka-menu-list .hakka-btn')).map((b) => b.textContent)
    expect(menuButtons).toEqual(expect.arrayContaining(['cURL', 'fetch', 'axios', 'HTTPie', 'Python', 'MSW handler']))
  })
})

describe('Request diff', () => {
  it('compares two selected requests and shows header/body diffs', async () => {
    client.ingest(
      makeRequest({
        id: 'diff-a',
        url: 'https://api.example.com/a',
        requestHeaders: { accept: 'application/json' },
        responseBody: '{"x":1}',
      }),
    )
    client.ingest(
      makeRequest({
        id: 'diff-b',
        url: 'https://api.example.com/b',
        requestHeaders: { accept: 'text/plain' },
        responseBody: '{"x":2}',
      }),
    )
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    fireEvent.click(q(container, '.hakka-select-mode-btn') as HTMLElement)
    await flush()
    const rows = qa(container, '.hakka-row')
    fireEvent.click(rows[0] as HTMLElement)
    fireEvent.click(rows[1] as HTMLElement)
    await flush()

    const compareBtn = Array.from(qa(container, '.hakka-action-btn')).find((b) => /compare/i.test(b.textContent ?? ''))
    expect(compareBtn).toBeTruthy()
    fireEvent.click(compareBtn as HTMLElement)

    await waitFor(() => q(container, '.hakka-diff') !== null)
    expect(q(container, '.hakka-diff')).toBeTruthy()
    expect(container.textContent).toContain('accept: application/json')
    expect(container.textContent).toContain('accept: text/plain')

    // Bodies aren't in the slim mirror — the diff fetches them via getBodies
    // and fills them in async once that resolves.
    await waitFor(() => container.textContent?.includes('"x": 1') ?? false)
    expect(container.textContent).toContain('"x": 1')
    expect(container.textContent).toContain('"x": 2')

    const closeBtn = Array.from(qa(container, '.hakka-back-btn')).find((b) => /close diff/i.test(b.textContent ?? ''))
    fireEvent.click(closeBtn as HTMLElement)
    await flush()
    expect(q(container, '.hakka-diff')).toBeNull()
  })
})

// `logs` only ever holds slim (bodyless) requests once ingested through the
// store — every export path must hydrate its request set via getBodies
// before serializing, or HAR/repro/session exports lose response bodies.
describe('Exports include full bodies (hydrated via getBodies)', () => {
  it('the header Export > HAR menu includes the full response body', async () => {
    client.ingest(makeRequest({ id: 'export-full-1', responseBody: '{"hydrated":true}' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    // The summary leads with an icon (no text) plus a non-breaking-space JSX
    // gap before the label, so match on the trimmed label, not an exact string.
    const summary = Array.from(container.querySelectorAll('summary')).find((s) =>
      /^export$/i.test((s.textContent ?? '').trim()),
    )
    expect(summary).toBeTruthy()
    fireEvent.click(summary as HTMLElement)
    const harBtn = Array.from(qa(container, '.hakka-menu-list .hakka-btn')).find((b) => b.textContent === 'HAR')
    expect(harBtn).toBeTruthy()

    let capturedBlob: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      capturedBlob = blob as Blob
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    fireEvent.click(harBtn as HTMLElement)
    await waitFor(() => createSpy.mock.calls.length > 0)

    const text = await capturedBlob!.text()
    const har = JSON.parse(text)
    expect(har.log.entries[0].response.content.text).toBe('{"hydrated":true}')
  })

  it('bulk export HAR (selected requests) includes the full response body', async () => {
    client.ingest(makeRequest({ id: 'bulk-full-1', responseBody: '{"bulk":true}' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    fireEvent.click(q(container, '.hakka-select-mode-btn') as HTMLElement)
    await flush()
    fireEvent.click(q(container, '.hakka-row') as HTMLElement)
    await flush()

    let capturedBlob: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      capturedBlob = blob as Blob
      return 'blob:mock'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    const bulkHarBtn = Array.from(qa(container, '.hakka-action-btn')).find((b) => b.textContent === 'HAR')
    expect(bulkHarBtn).toBeTruthy()
    fireEvent.click(bulkHarBtn as HTMLElement)
    await waitFor(() => createSpy.mock.calls.length > 0)

    const text = await capturedBlob!.text()
    const har = JSON.parse(text)
    expect(har.log.entries[0].response.content.text).toBe('{"bulk":true}')
  })
})

describe('Session save/load', () => {
  it('Session menu exposes Save and Load actions', async () => {
    client.ingest(makeRequest({ id: 'sess-ui' }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const summary = Array.from(container.querySelectorAll('summary')).find((s) => /session/i.test(s.textContent ?? ''))
    expect(summary).toBeTruthy()
    fireEvent.click(summary as HTMLElement)

    const saveBtn = Array.from(qa(container, '.hakka-menu-list .hakka-btn')).find((b) => b.textContent === 'Save')
    const loadBtn = Array.from(qa(container, '.hakka-menu-list .hakka-btn')).find((b) => b.textContent === 'Load')
    expect(saveBtn).toBeTruthy()
    expect(loadBtn).toBeTruthy()

    // jsdom lacks full anchor-download semantics, so stub URL.createObjectURL/
    // revokeObjectURL and just verify Save doesn't throw.
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    fireEvent.click(saveBtn as HTMLElement)
    // Save hydrates full bodies via getBodies RPC before serializing — await that.
    await waitFor(() => createSpy.mock.calls.length > 0)
    expect(createSpy).toHaveBeenCalled()
    revokeSpy.mockRestore()
  })

  it('importing a session file merges requests into the store', async () => {
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const json = serializeSession([makeRequest({ id: 'imported-1', url: 'https://api.example.com/imported' })])
    const file = new File([json], 'session.hakka', { type: 'application/json' })
    const fileInput = q(container, 'input[type="file"]') as HTMLInputElement

    Object.defineProperty(fileInput, 'files', { value: [file], writable: false })
    fireEvent.change(fileInput)

    await waitFor(() => container.textContent?.includes('imported') ?? false)
    expect(container.textContent).toContain('imported')
  })
})

describe('Repro bundle download', () => {
  it('Session menu exposes a "Repro bundle" action that downloads a valid .hakka-repro payload', async () => {
    client.ingest(makeRequest({ id: 'repro-1', url: 'https://api.example.com/checkout', method: 'POST', status: 500 }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    const summary = Array.from(container.querySelectorAll('summary')).find((s) => /session/i.test(s.textContent ?? ''))
    expect(summary).toBeTruthy()
    fireEvent.click(summary as HTMLElement)

    const reproBtn = Array.from(qa(container, '.hakka-menu-list .hakka-btn')).find(
      (b) => b.textContent === 'Repro bundle',
    )
    expect(reproBtn).toBeTruthy()

    // jsdom lacks full anchor-download semantics — capture the Blob passed to
    // URL.createObjectURL and read it back to assert the actual payload shape.
    let capturedBlob: Blob | undefined
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      capturedBlob = blob as Blob
      return 'blob:mock'
    })
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    fireEvent.click(reproBtn as HTMLElement)
    // The repro bundle hydrates full bodies via getBodies RPC before serializing — await that.
    await waitFor(() => createSpy.mock.calls.length > 0)
    expect(createSpy).toHaveBeenCalled()

    const text = await capturedBlob!.text()
    const { requests, mocks, version } = deserializeReproBundle(text)
    expect(version).toBe(1)
    expect(requests.some((r) => r.id === 'repro-1')).toBe(true)
    expect(mocks.some((m) => m.pattern === '/checkout')).toBe(true)

    revokeSpy.mockRestore()
  })
})

describe('NL search toggle', () => {
  it('converts a natural-language phrase into the search DSL and applies it', async () => {
    client.ingest(makeRequest({ id: 'nl-ok', url: 'https://api.example.com/ok', status: 200 }))
    client.ingest(makeRequest({ id: 'nl-fail', url: 'https://api.example.com/fail', status: 500, error: undefined }))
    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(2)

    // The toggle reads "AI" (sparkle icon + label) and lives inside the
    // search field's trailing controls — target it by its stable aria-label.
    const nlBtn = q(container, '.hakka-search-trailing [aria-label="Toggle AI search"]') as HTMLElement
    expect(nlBtn).toBeTruthy()
    fireEvent.click(nlBtn)

    const search = q(container, '.hakka-search') as HTMLInputElement
    fireEvent.input(search, { target: { value: 'failed requests' } })
    await flush()

    // "failed requests" -> status:>=400, which should narrow to the 500 request only.
    expect(qa(container, '.hakka-row').length).toBe(1)
  })
})
