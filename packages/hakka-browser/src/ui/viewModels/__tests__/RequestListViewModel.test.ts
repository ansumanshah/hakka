import { compileQuery, deriveTraceId, sortRequests } from 'hakka-core'
import type { FrameworkSpan, NetworkRequest, SortField, SortOrder } from 'hakka-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { destroyStore, initStore, type StoreClient } from '../../../worker'
import { createFilterViewModel, toAdvancedQuery, type FilterState } from '../FilterViewModel'
import { createRequestListViewModel } from '../RequestListViewModel'

function makeSpan(id: string, overrides: Partial<FrameworkSpan> = {}): FrameworkSpan {
  return {
    id,
    traceId: 'trace-1',
    parentId: null,
    name: 'BaseServer.handleRequest',
    startTime: 0,
    endTime: 10,
    verbosity: 'primary',
    runtime: 'server',
    ...overrides,
  }
}

// Minimal WebSocket stand-in — needed because spans only ever enter the
// store via a relayed bridge frame (there is no client-side span "ingest" path).
class FakeBridgeSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readyState = FakeBridgeSocket.CONNECTING
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    registerSocket(this)
    setTimeout(() => {
      this.readyState = FakeBridgeSocket.OPEN
      this.onopen?.()
    }, 0)
  }
  send(): void {}
  close(): void {
    this.readyState = FakeBridgeSocket.CLOSED
    this.onclose?.({ code: 1000 })
  }
  emitFromHub(frame: { type: string; payload?: unknown }): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}
let lastSocket: FakeBridgeSocket | null = null
function registerSocket(socket: FakeBridgeSocket): void {
  lastSocket = socket
}

async function connectBridge(target: StoreClient, url: string): Promise<FakeBridgeSocket> {
  target.bridgeConnect(url)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const socket = lastSocket
  if (!socket) throw new Error('expected a bridge socket')
  return socket
}

// localStorage mock — FilterViewModel reads/writes persisted UI state.
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

function req(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://api.example.com/${id}`,
    method: 'GET',
    status: 200,
    // Not epoch-0 — the store's default 24h retention evicts older requests on ingest.
    startTime: Date.now(),
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...overrides,
  } as NetworkRequest
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

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

describe('RequestListViewModel', () => {
  it('backfills the historical store snapshot on construction', async () => {
    client.ingest(req('r1'))
    client.ingest(req('r2'))
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()

    expect(vm.getSnapshot().count).toBe(2)
    expect(
      vm
        .getSnapshot()
        .logs.map((r) => r.id)
        .sort(),
    ).toEqual(['r1', 'r2'])
    vm.destroy()
  })

  it('upserts a live re-dispatch by id instead of duplicating it', async () => {
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()

    client.ingest(req('dup', { duration: undefined }))
    await flush()
    expect(vm.getSnapshot().count).toBe(1)

    client.update({ id: 'dup', duration: 42 })
    await flush()
    expect(vm.getSnapshot().count).toBe(1)
    expect(vm.getSnapshot().logs.find((r) => r.id === 'dup')?.duration).toBe(42)

    vm.destroy()
  })

  it('reads FilterViewModel to filter by method', async () => {
    client.ingest(req('r1', { method: 'GET' }))
    client.ingest(req('r2', { method: 'POST' }))
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()
    expect(vm.getSnapshot().filtered.length).toBe(2)

    filters.intents.setMethodFilter('POST')
    await flush()
    const snap = vm.getSnapshot()
    expect(snap.filtered.map((r) => r.id)).toEqual(['r2'])
    expect(snap.isFiltered).toBe(true)

    vm.destroy()
  })

  it('groups by the FilterViewModel groupBy field', async () => {
    client.ingest(req('r1', { url: 'https://a.example.com/x' }))
    client.ingest(req('r2', { url: 'https://b.example.com/y' }))
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()
    expect(vm.getSnapshot().groups).toBeNull()

    filters.intents.setGroupBy('host')
    await flush()
    const groups = vm.getSnapshot().groups
    expect(groups).not.toBeNull()
    expect(groups!.length).toBe(2)

    vm.destroy()
  })

  it('clearLogs empties the mirror and clears the store', async () => {
    client.ingest(req('r1'))
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()
    expect(vm.getSnapshot().count).toBe(1)

    vm.intents.clearLogs()
    expect(vm.getSnapshot().count).toBe(0)

    vm.destroy()
  })

  it('loadSampleTraffic ingests sample requests through the normal store path', async () => {
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()
    expect(vm.getSnapshot().count).toBe(0)

    await vm.intents.loadSampleTraffic()
    await flush()
    expect(vm.getSnapshot().count).toBeGreaterThan(0)

    vm.destroy()
  })

  it('search suggestions rank recent filters, then matching hosts, then scope hints', async () => {
    client.ingest(req('r1', { url: 'https://api.example.com/x' }))
    const filters = createFilterViewModel()
    // A completed past search lands in recentFilters; clear the box back to
    // empty so the host-match check below isn't filtered against it.
    filters.intents.setFilterText('previous-search')
    filters.intents.setFilterText('')
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()

    const suggestions = vm.getSnapshot().searchSuggestions
    expect(suggestions[0]).toBe('previous-search')
    expect(suggestions).toContain('host:api.example.com')

    vm.destroy()
  })

  it('subscribe fires on upsert; destroy stops further notifications', async () => {
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    const listener = vi.fn()
    vm.subscribe(listener)
    await flush()

    client.ingest(req('r1'))
    await flush()
    expect(listener).toHaveBeenCalled()

    vm.destroy()
    const callsBefore = listener.mock.calls.length
    client.ingest(req('r2'))
    await flush()
    expect(listener.mock.calls.length).toBe(callsBefore)
  })
})

// ─── Incremental computeFiltered vs. a from-scratch recompute (property) ──────
//
// The incremental cache (RequestListViewModel.ts: filteredCache/applyRecordChange)
// must always agree with a naive `logs.filter(compileQuery(q))` + `sortRequests`
// pass over whatever `logs` currently holds. This drives a long randomized
// sequence of append/update/remove/filter-change/sort-change operations through
// the real view-model and, after every single op, recomputes the naive answer
// independently from the VM's own `logs` snapshot and asserts identical order.
// filterText is deliberately never touched here (stays '', below
// FILTER_DEBOUNCE_ABOVE) so debouncedFilterText === filterSnap.filterText
// always and the async body-match path (storeMatchIds) never engages — that
// path already forces a full rebuild by design (see refreshBodyMatch) and
// isn't what this property is targeting.
describe('RequestListViewModel — computeFiltered incremental vs. naive recompute (property)', () => {
  // Deterministic PRNG (mulberry32) — reproducible failures, no external dep.
  function mulberry32(seed: number): () => number {
    let a = seed
    return function random(): number {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function pick<T>(rand: () => number, arr: readonly T[]): T {
    return arr[Math.floor(rand() * arr.length)]!
  }

  function naiveFilteredIds(logs: NetworkRequest[], filterSnap: FilterState): string[] {
    const q = toAdvancedQuery(filterSnap, filterSnap.filterText)
    const matched = logs.filter(compileQuery(q))
    return sortRequests(matched, filterSnap.sortField, filterSnap.sortOrder).map((r) => r.id)
  }

  const METHODS = ['', 'GET', 'POST', 'PUT'] as const
  const STATUSES = [200, 201, 404, 500] as const
  const SORT_FIELDS: SortField[] = ['time', 'duration', 'size', 'status']
  const SORT_ORDERS: SortOrder[] = ['asc', 'desc']

  it('stays identical to a from-scratch recompute across a randomized operation sequence', async () => {
    const rand = mulberry32(20260816)
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()

    const liveIds: string[] = [] // ids currently in the VIEW (removeFromView'd ids drop out)
    let nextId = 0

    function assertMatchesNaive(): void {
      const snap = vm.getSnapshot()
      const expected = naiveFilteredIds(snap.logs, filters.getSnapshot())
      expect(snap.filtered.map((r) => r.id)).toEqual(expected)
    }

    const OPS = 150
    for (let i = 0; i < OPS; i++) {
      const roll = rand()
      if (roll < 0.4 || liveIds.length === 0) {
        // append — a genuinely new id, live via the store's ingest/subscribe path
        const id = `p-${nextId}`
        nextId += 1
        liveIds.push(id)
        client.ingest(
          req(id, {
            method: pick(rand, METHODS) || 'GET',
            status: pick(rand, STATUSES),
            startTime: Date.now() - Math.floor(rand() * 10_000),
            duration: Math.floor(rand() * 500),
            requestBodySize: Math.floor(rand() * 1_000),
            responseBodySize: Math.floor(rand() * 1_000),
          }),
        )
      } else if (roll < 0.7) {
        // in-place update — same id, streamed patch through the store's update() path
        const id = pick(rand, liveIds)
        client.update({
          id,
          status: pick(rand, STATUSES),
          duration: Math.floor(rand() * 500),
          requestBodySize: Math.floor(rand() * 1_000),
          responseBodySize: Math.floor(rand() * 1_000),
        })
      } else if (roll < 0.85) {
        // removal
        const idx = Math.floor(rand() * liveIds.length)
        const id = liveIds[idx]!
        vm.intents.removeFromView(id)
        liveIds.splice(idx, 1)
      } else if (roll < 0.93) {
        // filter change — full-pass trigger
        filters.intents.setMethodFilter(pick(rand, METHODS))
      } else {
        // sort-key change — full-pass trigger
        filters.intents.setSortField(pick(rand, SORT_FIELDS))
        filters.intents.setSortOrder(pick(rand, SORT_ORDERS))
      }

      // eslint-disable-next-line no-await-in-loop
      await flush()
      assertMatchesNaive()
    }

    vm.destroy()
  })
})

describe('RequestListViewModel — framework spans (Next Request Insights design doc §5)', () => {
  beforeEach(() => {
    lastSocket = null
    vi.stubGlobal('WebSocket', FakeBridgeSocket)
  })
  afterEach(() => {
    client.bridgeDisconnect()
    vi.unstubAllGlobals()
  })

  it('mirrors a live bridge-relayed span into spansByTrace via subscribeSpans', async () => {
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()

    const socket = await connectBridge(client, 'ws://test-hub-vm-1')
    socket.emitFromHub({ type: 'span', payload: makeSpan('s1', { traceId: 'trace-live' }) })

    expect(
      vm
        .getSnapshot()
        .spansByTrace.get('trace-live')
        ?.map((s) => s.id),
    ).toEqual(['s1'])
    vm.destroy()
  })

  it('backfills spans for a trace group via getSpansForTrace once groupBy transitions into "trace"', async () => {
    // Spans arrive over the bridge before the view-model (and its live
    // subscribeSpans feed) exists — only a groupBy->'trace' backfill surfaces them.
    const preClient = client
    const socket = await connectBridge(preClient, 'ws://test-hub-vm-2')
    // Real spans carry the derived W3C traceId, not the raw correlation id —
    // the backfill path must join on the derived key.
    socket.emitFromHub({ type: 'span', payload: makeSpan('s-pre', { traceId: deriveTraceId('trace-pre') }) })

    client.ingest(req('trace-pre', { correlationId: 'trace-pre' }))
    const filters = createFilterViewModel()
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()
    expect(vm.getSnapshot().spansByTrace.has(deriveTraceId('trace-pre'))).toBe(false) // not backfilled yet — groupBy is still 'none'

    filters.intents.setGroupBy('trace')
    await flush()
    expect(
      vm
        .getSnapshot()
        .spansByTrace.get(deriveTraceId('trace-pre'))
        ?.map((s) => s.id),
    ).toEqual(['s-pre'])

    vm.destroy()
  })

  it('backfills spans on construction when groupBy is already "trace" (the persisted-state case)', async () => {
    // Reproduces mounting with groupBy:'trace' already in the FIRST snapshot
    // observed — the 'none'->'trace' transition check in onFiltersChanged
    // never fires here, so only a construction-time backfill covers it.
    const preClient = client
    const socket = await connectBridge(preClient, 'ws://test-hub-vm-3')
    socket.emitFromHub({ type: 'span', payload: makeSpan('s-pre', { traceId: deriveTraceId('trace-pre') }) })
    client.ingest(req('trace-pre', { correlationId: 'trace-pre' }))

    const filters = createFilterViewModel()
    filters.intents.setGroupBy('trace')
    const vm = createRequestListViewModel({ store: client, filters })
    await flush()

    expect(
      vm
        .getSnapshot()
        .spansByTrace.get(deriveTraceId('trace-pre'))
        ?.map((s) => s.id),
    ).toEqual(['s-pre'])

    vm.destroy()
  })
})
