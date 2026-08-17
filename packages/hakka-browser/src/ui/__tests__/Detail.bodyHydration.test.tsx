/**
 * Detail — on-demand body hydration.
 *
 * Under the default `slimEcho`, the request object Detail receives from
 * Inspector's mirrored `logs` never carries requestBody/responseBody — these
 * tests exercise the `getBody` RPC round-trip Detail runs on selection, and
 * never a stale/wrong body across a fast selection change.
 *
 * The body TEXT region specifically (Detail.tsx's `bodyAsync` memo, wrapped
 * in `<Loading>`) is a genuine Solid 2.0 async read: switching rows keeps the
 * PREVIOUS row's body visible (dimmed via `isPending`) instead of blanking —
 * the "stale-content revalidation" tests below pin the fetch open with a
 * deferred promise to observe that in-between state deterministically.
 */
import { render, fireEvent } from '@solidjs/testing-library'
import { mockEngine, type NetworkRequest } from 'hakka-core'
import { createSignal, flush } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { Detail } from '../Detail'

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'd1',
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    ...over,
  }
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function clickTab(container: HTMLElement, label: string): void {
  const btn = Array.from(container.querySelectorAll('.hakka-tab')).find((t) => t.textContent === label) as HTMLElement
  fireEvent.click(btn)
}

let client: StoreClient

beforeEach(() => {
  client = initStore({ forceInProcess: true })
  mockEngine.clearRules()
})

afterEach(() => {
  destroyStore()
  mockEngine.clearRules()
  vi.restoreAllMocks()
})

describe('Detail — body hydration via getBody', () => {
  it('renders "No response body" until the RPC resolves, then shows the real body', async () => {
    client.ingest(req({ id: 'hydrate-1', responseBody: '{"ok":true}' }))
    // slim = what Inspector actually hands Detail (no bodies).
    const slim = req({ id: 'hydrate-1' })
    const { container } = render(() => <Detail req={slim} onBack={() => {}} />)

    clickTab(container, 'Response')
    await waitFor(() => container.textContent?.includes('ok') ?? false)
    expect(container.textContent).toContain('ok')
    expect(container.querySelector('.hakka-empty-hint')).toBeNull()
  })

  it('falls back to props.req bodies when the id is not (or no longer) in the store', async () => {
    // Never ingested — getBody resolves to null (not found); Detail must keep
    // showing whatever the caller passed directly.
    const full = req({ id: 'not-in-store', responseBody: '{"local":true}' })
    const { container } = render(() => <Detail req={full} onBack={() => {}} />)

    clickTab(container, 'Response')
    // Give the (resolving-to-null) fetch a chance to land before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container.textContent).toContain('local')
    expect(container.querySelector('.hakka-empty-hint')).toBeNull()
  })

  it('guards a fast selection change — an in-flight fetch for the old id never bleeds into the new one', async () => {
    client.ingest(req({ id: 'race-a', responseBody: 'BODY-A-MARKER' }))
    client.ingest(req({ id: 'race-b', responseBody: 'BODY-B-MARKER' }))

    const [sel, setSel] = createSignal<NetworkRequest>(req({ id: 'race-a' }))
    const { container } = render(() => <Detail req={sel()} onBack={() => {}} />)
    clickTab(container, 'Response')

    // Switch selection before the first id's fetch has had a chance to resolve.
    setSel(req({ id: 'race-b' }))

    await waitFor(() => container.textContent?.includes('BODY-B-MARKER') ?? false)
    expect(container.textContent).toContain('BODY-B-MARKER')
    expect(container.textContent).not.toContain('BODY-A-MARKER')
  })

  it('mock rule generation ("Mock this") uses the hydrated body, not the slim one', async () => {
    client.ingest(req({ id: 'mock-1', status: 200, responseBody: '{"id":1}' }))
    const slim = req({ id: 'mock-1', status: 200 })
    const { container } = render(() => <Detail req={slim} onBack={() => {}} />)

    clickTab(container, 'Response')
    await waitFor(() => container.textContent?.includes('"id":1') ?? false)

    const mockBtn = Array.from(container.querySelectorAll('.hakka-curl-btn')).find((b) =>
      /mock this/i.test(b.textContent ?? ''),
    ) as HTMLElement
    expect(mockBtn).toBeTruthy()

    fireEvent.click(mockBtn)

    const rules = mockEngine.getRules()
    expect(rules).toHaveLength(1)
    // generateMockRules serializes the response body to a string — an unhydrated
    // (slim) request would have produced an empty-string body here instead.
    expect(rules[0]?.response.body).toBe('{"id":1}')
  })

  describe('stale-content revalidation (body text region only)', () => {
    it('switching rows keeps the previous row body visible until the new fetch resolves', async () => {
      client.ingest(req({ id: 'stale-a', responseBody: 'BODY-A-MARKER' }))
      client.ingest(req({ id: 'stale-b', responseBody: 'BODY-B-MARKER' }))

      // Pin the second id's fetch open so the in-between (pending) state can
      // be observed deterministically instead of racing real microtask timing.
      let resolveB!: (v: { requestBody: string | null; responseBody: string | null } | null) => void
      const realGetBody = client.getBody.bind(client)
      const spy = vi.spyOn(client, 'getBody').mockImplementation((id: string) => {
        if (id === 'stale-b') return new Promise((resolve) => (resolveB = resolve))
        return realGetBody(id)
      })

      const [sel, setSel] = createSignal<NetworkRequest>(req({ id: 'stale-a' }))
      const { container } = render(() => <Detail req={sel()} onBack={() => {}} />)
      clickTab(container, 'Response')

      await waitFor(() => container.textContent?.includes('BODY-A-MARKER') ?? false)

      setSel(req({ id: 'stale-b' }))
      await flush()

      // Still showing row A's body — not blanked, not "No response body" —
      // while row B's fetch is still pending.
      expect(container.textContent).toContain('BODY-A-MARKER')
      expect(container.querySelector('.hakka-empty-hint')).toBeNull()

      resolveB({ requestBody: null, responseBody: 'BODY-B-MARKER' })
      await waitFor(() => container.textContent?.includes('BODY-B-MARKER') ?? false)
      expect(container.textContent).toContain('BODY-B-MARKER')
      expect(container.textContent).not.toContain('BODY-A-MARKER')

      spy.mockRestore()
    })

    it('dims the body region (isPending) only while a newer selection is in flight', async () => {
      client.ingest(req({ id: 'pend-a', responseBody: 'BODY-A-MARKER' }))
      client.ingest(req({ id: 'pend-b', responseBody: 'BODY-B-MARKER' }))

      let resolveB!: (v: { requestBody: string | null; responseBody: string | null } | null) => void
      const realGetBody = client.getBody.bind(client)
      const spy = vi.spyOn(client, 'getBody').mockImplementation((id: string) => {
        if (id === 'pend-b') return new Promise((resolve) => (resolveB = resolve))
        return realGetBody(id)
      })

      const [sel, setSel] = createSignal<NetworkRequest>(req({ id: 'pend-a' }))
      const { container } = render(() => <Detail req={sel()} onBack={() => {}} />)
      clickTab(container, 'Response')
      await waitFor(() => container.textContent?.includes('BODY-A-MARKER') ?? false)

      expect(container.querySelector('.hakka-body-pending')).toBeNull()

      setSel(req({ id: 'pend-b' }))
      await flush()
      expect(container.querySelector('.hakka-body-pending')).toBeTruthy()

      resolveB({ requestBody: null, responseBody: 'BODY-B-MARKER' })
      await waitFor(() => container.textContent?.includes('BODY-B-MARKER') ?? false)
      expect(container.querySelector('.hakka-body-pending')).toBeNull()

      spy.mockRestore()
    })
  })
})
