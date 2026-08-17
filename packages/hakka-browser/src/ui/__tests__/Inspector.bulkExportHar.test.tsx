// The bulk-export-HAR test in Inspector.uxFeatures.test.tsx only ever ingests
// and selects a single request, so it can't prove an UNselected request in
// the same capture list gets excluded. This selects a strict subset of a
// larger list and asserts both `getBodies` and the exported HAR only ever
// see that subset.
import { render, fireEvent } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
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

describe('Inspector bulk export HAR — selection scoping', () => {
  it('exports only the checked requests, excluding an unselected request in the same list', async () => {
    client.ingest(makeRequest({ id: 'sel-a', url: 'https://api.example.com/alpha', responseBody: '{"n":"alpha"}' }))
    client.ingest(makeRequest({ id: 'sel-b', url: 'https://api.example.com/beta', responseBody: '{"n":"beta"}' }))
    client.ingest(makeRequest({ id: 'sel-c', url: 'https://api.example.com/gamma', responseBody: '{"n":"gamma"}' }))

    // initStore memoizes a singleton, so this client is the same instance
    // store() returns — spying on it covers Inspector's export path
    // (withFullBodies -> store().getBodies(ids)).
    const getBodiesSpy = vi.spyOn(client, 'getBodies')

    const { container } = render(() => <Inspector />)
    fireEvent.contextMenu(q(container, '.hakka-toggle') as HTMLElement)
    await flush()

    expect(qa(container, '.hakka-row').length).toBe(3)

    fireEvent.click(q(container, '.hakka-select-mode-btn') as HTMLElement)
    await flush()
    const rows = Array.from(qa(container, '.hakka-row')) as HTMLElement[]
    const alphaRow = rows.find((r) => r.textContent?.includes('/alpha'))
    const betaRow = rows.find((r) => r.textContent?.includes('/beta'))
    const gammaRow = rows.find((r) => r.textContent?.includes('/gamma'))
    expect(alphaRow).toBeTruthy()
    expect(betaRow).toBeTruthy()
    expect(gammaRow).toBeTruthy()

    fireEvent.click(alphaRow as HTMLElement)
    fireEvent.click(gammaRow as HTMLElement)
    await flush()

    expect(q(container, '.hakka-action-bar')?.textContent).toContain('2 selected')

    // jsdom lacks full anchor-download semantics — capture the Blob handed to
    // URL.createObjectURL and read it back to inspect the actual HAR payload.
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

    // Must be exactly the two checked ids, never the full capture list.
    expect(getBodiesSpy).toHaveBeenCalledTimes(1)
    expect(getBodiesSpy.mock.calls[0]![0].slice().sort()).toEqual(['sel-a', 'sel-c'])

    const text = await capturedBlob!.text()
    const har = JSON.parse(text) as { log: { entries: { request: { url: string } }[] } }
    const urls = har.log.entries.map((e) => e.request.url)

    expect(urls).toHaveLength(2)
    expect(urls).toContain('https://api.example.com/alpha')
    expect(urls).toContain('https://api.example.com/gamma')
    expect(urls).not.toContain('https://api.example.com/beta')
  })
})
