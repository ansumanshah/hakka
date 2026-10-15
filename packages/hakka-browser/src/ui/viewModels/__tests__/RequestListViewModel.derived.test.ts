/**
 * RequestListViewModel — values derived from the log (search-suggestion hosts, the
 * server-capture flag) are maintained as records arrive, not recomputed per snapshot.
 */
import type { NetworkRequest } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destroyStore, initStore, type StoreClient } from '../../../worker'
import { createFilterViewModel } from '../FilterViewModel'
import { createRequestListViewModel } from '../RequestListViewModel'

function makeLocalStorageMock(): Storage {
  let store: Record<string, string> = {}
  return {
    get length() {
      return Object.keys(store).length
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
}
const lsMock = makeLocalStorageMock()

const req = (id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest =>
  ({
    id,
    url: `https://api.example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...overrides,
  }) as NetworkRequest

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let client: StoreClient

beforeEach(() => {
  vi.stubGlobal('localStorage', lsMock)
  lsMock.clear()
  client = initStore({ forceInProcess: true })
})
afterEach(() => {
  destroyStore()
  vi.unstubAllGlobals()
})

describe('RequestListViewModel derived values', () => {
  it('lists each host once across repeated and updated requests, newest host first, and forgets hosts on clear', async () => {
    const vm = createRequestListViewModel({ store: client, filters: createFilterViewModel() })
    await flush()
    client.ingest(req('a1', { url: 'https://old.example.com/a' }))
    client.ingest(req('a2', { url: 'https://old.example.com/b' }))
    await flush()
    client.ingest(req('b1', { url: 'https://new.example.com/a' }))
    client.ingest(req('b1', { url: 'https://new.example.com/a', status: 500 }))
    await flush()

    const hosts = vm.getSnapshot().searchSuggestions.filter((s) => s.startsWith('host:') && s.length > 'host:'.length)
    expect(hosts).toEqual(['host:new.example.com', 'host:old.example.com'])

    vm.intents.clearLogs()
    expect(vm.getSnapshot().searchSuggestions).not.toContain('host:new.example.com')
    vm.destroy()
  })

  it('flags server captures once one arrives and clears the flag with the log', async () => {
    const vm = createRequestListViewModel({ store: client, filters: createFilterViewModel() })
    await flush()
    client.ingest(req('c1'))
    await flush()
    expect(vm.getSnapshot().hasServerCaptures).toBe(false)
    client.ingest(req('s1', { runtime: 'server' }))
    await flush()
    expect(vm.getSnapshot().hasServerCaptures).toBe(true)
    vm.intents.clearLogs()
    expect(vm.getSnapshot().hasServerCaptures).toBe(false)
    vm.destroy()
  })
})
