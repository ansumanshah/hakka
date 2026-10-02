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
  it('preserves live inserts and updates received before the initial snapshot resolves', async () => {
    let resolveSnapshot!: (rows: NetworkRequest[]) => void
    let emit!: (row: NetworkRequest) => void
    const vm = createStatsViewModel({
      store: {
        getSnapshot: () =>
          new Promise((resolve) => {
            resolveSnapshot = resolve
          }),
        subscribe: (callback) => {
          emit = callback
          return () => {}
        },
      },
    })

    emit(req({ id: 'live', duration: 20 }))
    emit(req({ id: 'existing', duration: 30 }))
    resolveSnapshot([req({ id: 'existing', duration: 10 }), req({ id: 'backfill', duration: 40 })])
    await flush()

    expect(vm.getSnapshot().total).toBe(3)
    expect(vm.getSnapshot().duration?.avg).toBe(30)
    vm.destroy()
  })

  it('resets all aggregates on clear and captures new records afterward', async () => {
    client.ingest(req({ responseBodySize: 512, duration: 42 }))
    const vm = createStatsViewModel({ store: client })
    await flush()
    const listener = vi.fn()
    vm.subscribe(listener)

    client.clear()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(vm.getSnapshot()).toEqual({
      total: 0,
      success: 0,
      error: 0,
      pending: 0,
      statusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
      method: { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0, OTHER: 0 },
      bytes: 0,
      duration: null,
      uniqueHosts: 0,
    })
    client.ingest(req({ id: 'after-clear', duration: 10, responseBodySize: 100 }))
    expect(vm.getSnapshot().total).toBe(1)
    expect(vm.getSnapshot().bytes).toBe(100)
    expect(vm.getSnapshot().duration?.avg).toBe(10)
    vm.destroy()
    listener.mockClear()
    client.clear()
    expect(listener).not.toHaveBeenCalled()
    expect(vm.getSnapshot().total).toBe(1)
  })

  it('ignores an initial snapshot that resolves after clear without losing new records', async () => {
    client.ingest(req({ id: 'before-clear', duration: 100 }))
    const initialSnapshot = await client.getSnapshot()
    let resolveSnapshot!: (rows: NetworkRequest[]) => void
    const vm = createStatsViewModel({
      store: {
        ...client,
        getSnapshot: () =>
          new Promise((resolve) => {
            resolveSnapshot = resolve
          }),
      },
    })
    client.clear()
    client.ingest(req({ id: 'after-clear', duration: 10 }))
    resolveSnapshot(initialSnapshot)
    await flush()
    expect(vm.getSnapshot().total).toBe(1)
    expect(vm.getSnapshot().duration?.avg).toBe(10)
    vm.destroy()
  })

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
