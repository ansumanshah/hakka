/**
 * Every captured request is dispatched at least twice (a headers-only
 * `ingest`, then a body-enriched `update`), so `subscribe` must upsert by
 * id instead of prepending blindly.
 */
import type { NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destroyStore, initStore, type StoreClient } from '../../../worker'
import { createStatsViewModel } from '../StatsViewModel'

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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let client: StoreClient

beforeEach(() => {
  client = initStore({ forceInProcess: true })
})
afterEach(() => destroyStore())

describe('StatsViewModel', () => {
  it('dedups a headers-emit + body-emit pair for the same id, not double-counted', async () => {
    client.ingest(req({ duration: undefined, responseBodySize: undefined }))
    const vm = createStatsViewModel({ store: client })
    await flush()
    expect(vm.getSnapshot().total).toBe(1)

    client.update({ id: 'dup-1', duration: 42, responseBodySize: 512 })
    await flush()
    expect(vm.getSnapshot().total).toBe(1)

    client.ingest(req({ id: 'dup-2', status: 404, method: 'POST' }))
    await flush()
    expect(vm.getSnapshot().total).toBe(2)

    vm.destroy()
  })

  it('aggregates status classes, methods, bytes, and duration percentiles', async () => {
    client.ingest(req({ id: 'a', status: 200, method: 'GET', responseBodySize: 100, duration: 10 }))
    client.ingest(req({ id: 'b', status: 500, method: 'POST', responseBodySize: 200, duration: 20 }))
    const vm = createStatsViewModel({ store: client })
    await flush()

    const snap = vm.getSnapshot()
    expect(snap.total).toBe(2)
    expect(snap.statusClass['2xx']).toBe(1)
    expect(snap.statusClass['5xx']).toBe(1)
    expect(snap.method.GET).toBe(1)
    expect(snap.method.POST).toBe(1)
    expect(snap.bytes).toBe(300)
    expect(snap.duration?.count).toBe(2)
    expect(snap.duration?.avg).toBe(15)

    vm.destroy()
  })

  it('subscribe fires on change; destroy stops further updates', async () => {
    const vm = createStatsViewModel({ store: client })
    const listener = vi.fn()
    vm.subscribe(listener)

    client.ingest(req())
    await flush()
    expect(listener).toHaveBeenCalled()

    vm.destroy()
    const callsBefore = listener.mock.calls.length
    client.ingest(req({ id: 'after-destroy' }))
    await flush()
    expect(listener.mock.calls.length).toBe(callsBefore)
  })
})
