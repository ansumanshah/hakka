/**
 * Every captured request is dispatched at least twice — a headers-only
 * `ingest`, then a body-enriched `update` once the response arrives.
 * StatsTab.subscribe must upsert by id (like Inspector's `upsert`) instead of
 * prepending blindly, or the aggregates double-count and the backing array
 * grows unbounded for the panel's mounted lifetime.
 */
import { render } from '@solidjs/testing-library'
import type { NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initStore, destroyStore, type StoreClient } from '../../worker'
import { StatsTab } from '../StatsTab'

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function req(over: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'dup-1',
    url: 'https://api.example.com/users',
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...over,
  } as NetworkRequest
}

describe('StatsTab — dedup by id', () => {
  let client: StoreClient
  beforeEach(() => {
    client = initStore({ forceInProcess: true })
  })
  afterEach(() => destroyStore())

  it('counts a headers-emit + body-emit pair for the same request once, not twice', async () => {
    // Headers-only emit lands before mount, so it arrives via the initial
    // snapshot RPC (not the live `subscribe` stream), avoiding a race with
    // that snapshot resolution overwriting live state.
    client.ingest(req({ duration: undefined, responseBodySize: undefined }))

    const { container } = render(() => <StatsTab active={true} />)
    await flush()
    // No tab-level count badge (DESIGN.md "Panel section anatomy" — the tab
    // strip is the title); Total requests is the Overview table's first row.
    expect(container.querySelector('.hakka-kv-value')?.textContent).toBe('1')

    // Body-emit re-dispatch for the *same* id, now via the live subscribe path.
    client.update({ id: 'dup-1', duration: 42, responseBodySize: 512 })
    await flush()

    // Still one request — the merged record replaced the existing entry
    // in place instead of being appended as a duplicate.
    expect(container.querySelector('.hakka-kv-value')?.textContent).toBe('1')

    // A genuinely new request brings the total to 2 (not 3+).
    client.ingest(req({ id: 'dup-2', status: 404, method: 'POST' }))
    await flush()

    expect(container.querySelector('.hakka-kv-value')?.textContent).toBe('2')
  })
})
