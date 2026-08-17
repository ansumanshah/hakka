import type { NetworkRequest } from 'hakka-core'
import { describe, expect, it, vi } from 'vitest'

import { createRequestDetailViewModel, type RequestDetailStore } from '../RequestDetailViewModel'

function req(id: string, overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id,
    url: `https://api.example.com/${id}`,
    method: 'GET',
    status: 200,
    startTime: 0,
    requestHeaders: {},
    responseHeaders: {},
    source: 'fetch',
    ...overrides,
  } as NetworkRequest
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function fakeStore(
  bodies: Map<string, { requestBody: string | null; responseBody: string | null }>,
): RequestDetailStore {
  return {
    getBody: (id) => Promise.resolve(bodies.get(id) ?? null),
    getSnapshot: () => Promise.resolve([]),
  }
}

describe('RequestDetailViewModel', () => {
  it('getSnapshot().request is null before any selection', () => {
    const vm = createRequestDetailViewModel()
    expect(vm.getSnapshot().request).toBeNull()
  })

  it('selectRequest shows the raw request immediately, then merges in a hydrated body', async () => {
    const bodies = new Map([['r1', { requestBody: null, responseBody: '{"ok":true}' }]])
    const vm = createRequestDetailViewModel({ store: fakeStore(bodies) })

    vm.intents.selectRequest(req('r1'))
    expect(vm.getSnapshot().request?.id).toBe('r1')
    expect(vm.getSnapshot().request?.responseBody).toBeUndefined()

    await flush()
    expect(vm.getSnapshot().request?.responseBody).toBe('{"ok":true}')
  })

  it('a same-id reselect keeps the last-hydrated body while a fresh fetch is in flight', async () => {
    const bodies = new Map([['r1', { requestBody: null, responseBody: '{"v":1}' }]])
    const vm = createRequestDetailViewModel({ store: fakeStore(bodies) })

    vm.intents.selectRequest(req('r1'))
    await flush()
    expect(vm.getSnapshot().request?.responseBody).toBe('{"v":1}')

    // Same id, new object reference (e.g. a growth field changed) — body stays
    // visible immediately, not blanked, while the new fetch resolves.
    vm.intents.selectRequest(req('r1', { duration: 42 }))
    expect(vm.getSnapshot().request?.responseBody).toBe('{"v":1}')
    expect(vm.getSnapshot().request?.duration).toBe(42)
  })

  it('a different-id reselect blanks the body immediately', async () => {
    const bodies = new Map([['r1', { requestBody: null, responseBody: '{"v":1}' }]])
    const vm = createRequestDetailViewModel({ store: fakeStore(bodies) })

    vm.intents.selectRequest(req('r1'))
    await flush()
    expect(vm.getSnapshot().request?.responseBody).toBe('{"v":1}')

    vm.intents.selectRequest(req('r2'))
    expect(vm.getSnapshot().request?.id).toBe('r2')
    expect(vm.getSnapshot().request?.responseBody).toBeUndefined()
  })

  it('a stale fetch resolving after a newer selection is dropped', async () => {
    let resolveFirst!: (v: { requestBody: string | null; responseBody: string | null } | null) => void
    const store: RequestDetailStore = {
      getBody: vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
        .mockImplementationOnce(() => Promise.resolve({ requestBody: null, responseBody: '{"second":true}' })),
      getSnapshot: () => Promise.resolve([]),
    }
    const vm = createRequestDetailViewModel({ store })

    vm.intents.selectRequest(req('r1'))
    vm.intents.selectRequest(req('r2')) // second fetch fires, first is now stale
    await flush()
    expect(vm.getSnapshot().request?.responseBody).toBe('{"second":true}')

    // The stale first fetch resolves late — must not clobber the current selection.
    resolveFirst({ requestBody: null, responseBody: '{"first":true}' })
    await flush()
    expect(vm.getSnapshot().request?.responseBody).toBe('{"second":true}')
  })

  it('selectRequestId resolves against the injected store snapshot', async () => {
    const store: RequestDetailStore = {
      getBody: () => Promise.resolve(null),
      getSnapshot: () => Promise.resolve([req('r1'), req('r2')]),
    }
    const vm = createRequestDetailViewModel({ store })

    await vm.intents.selectRequestId('r2')
    expect(vm.getSnapshot().request?.id).toBe('r2')
  })

  it('clear() resets to null', async () => {
    const vm = createRequestDetailViewModel({ store: fakeStore(new Map()) })
    vm.intents.selectRequest(req('r1'))
    vm.intents.clear()
    expect(vm.getSnapshot().request).toBeNull()
  })

  it('subscribe fires on change; unsubscribe stops notifications', async () => {
    const vm = createRequestDetailViewModel({
      store: fakeStore(new Map([['r1', { requestBody: null, responseBody: 'x' }]])),
    })
    const listener = vi.fn()
    const unsub = vm.subscribe(listener)

    vm.intents.selectRequest(req('r1'))
    await flush()
    expect(listener).toHaveBeenCalled()

    const callsBefore = listener.mock.calls.length
    unsub()
    vm.intents.selectRequest(req('r2'))
    await flush()
    expect(listener.mock.calls.length).toBe(callsBefore)
  })
})
