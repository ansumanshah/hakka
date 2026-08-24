import type { NetworkRequest } from 'hakka-core'
import { describe, expect, it } from 'vitest'

import type { HakkaRozeniteEventMap } from '../../shared/protocol'
import { createPanelStore } from '../panelStore'
import type { PanelStoreClientLike } from '../panelStore'

/** Same fake-client shape as `react-native/bridge.test.ts` — an in-memory
 * stand-in for `RozeniteDevToolsClient`, no real Rozenite channel involved. */
function createFakeClient(): PanelStoreClientLike & {
  sent: Array<{ type: string; payload: unknown }>
  fire<TType extends keyof HakkaRozeniteEventMap>(type: TType, payload: HakkaRozeniteEventMap[TType]): void
} {
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  const sent: Array<{ type: string; payload: unknown }> = []

  return {
    sent,
    send(type, payload) {
      sent.push({ type: type as string, payload })
    },
    onMessage(type, listener) {
      const set = listeners.get(type as string) ?? new Set()
      set.add(listener as (payload: unknown) => void)
      listeners.set(type as string, set)
      return {
        remove: () => {
          set.delete(listener as (payload: unknown) => void)
        },
      }
    },
    fire(type, payload) {
      const set = listeners.get(type as string)
      if (!set) return
      for (const listener of set) listener(payload)
    },
  }
}

function makeRequest(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://example.com/api',
    method: 'GET',
    startTime: 0,
    ...overrides,
  } as NetworkRequest
}

describe('createPanelStore', () => {
  it('sends get-snapshot immediately on construction', () => {
    const client = createFakeClient()
    createPanelStore(client)

    expect(client.sent).toEqual([{ type: 'get-snapshot', payload: {} }])
  })

  it('mirrors incoming request frames into getSnapshot(), newest-first', async () => {
    const client = createFakeClient()
    const store = createPanelStore(client)

    const a = makeRequest({ id: 'a' })
    const b = makeRequest({ id: 'b' })
    client.fire('request', a)
    client.fire('request', b)

    await expect(store.getSnapshot()).resolves.toEqual([b, a])
  })

  it('upserts by id instead of duplicating a request that gains a later update', async () => {
    const client = createFakeClient()
    const store = createPanelStore(client)

    client.fire('request', makeRequest({ id: 'a', status: undefined }))
    client.fire('request', makeRequest({ id: 'a', status: 200 }))

    const snapshot = await store.getSnapshot()
    expect(snapshot).toHaveLength(1)
    expect(snapshot[0]?.status).toBe(200)
  })

  it('notifies subscribers with each incoming request', () => {
    const client = createFakeClient()
    const store = createPanelStore(client)
    const seen: NetworkRequest[] = []
    const unsubscribe = store.subscribe((req) => seen.push(req))

    const a = makeRequest({ id: 'a' })
    client.fire('request', a)
    expect(seen).toEqual([a])

    unsubscribe()
    client.fire('request', makeRequest({ id: 'b' }))
    expect(seen).toEqual([a]) // unaffected — unsubscribed before the second frame
  })

  it('clear() empties the local mirror and asks the RN side to clear too', async () => {
    const client = createFakeClient()
    const store = createPanelStore(client)
    client.fire('request', makeRequest({ id: 'a' }))
    client.sent.length = 0

    store.clear()

    await expect(store.getSnapshot()).resolves.toEqual([])
    expect(client.sent).toEqual([{ type: 'clear', payload: {} }])
  })

  it('a cleared ack from the RN side empties the local mirror without re-sending clear', async () => {
    const client = createFakeClient()
    const store = createPanelStore(client)
    client.fire('request', makeRequest({ id: 'a' }))
    client.sent.length = 0

    client.fire('cleared', {})

    await expect(store.getSnapshot()).resolves.toEqual([])
    expect(client.sent).toEqual([])
  })

  it('a cleared ack notifies onClear listeners so a mirror outside subscribe() can resync', () => {
    const client = createFakeClient()
    const store = createPanelStore(client)
    let calls = 0
    const unsubscribe = store.onClear(() => {
      calls += 1
    })

    client.fire('cleared', {})
    expect(calls).toBe(1)

    unsubscribe()
    client.fire('cleared', {})
    expect(calls).toBe(1) // unaffected — unsubscribed before the second ack
  })

  it('ingest() (the "load sample traffic" path) only updates the local mirror', async () => {
    const client = createFakeClient()
    const store = createPanelStore(client)
    client.sent.length = 0

    store.ingest(makeRequest({ id: 'sample' }))

    await expect(store.getSnapshot()).resolves.toEqual([makeRequest({ id: 'sample' })])
    expect(client.sent).toEqual([]) // never forwarded to the device
  })

  it('destroy() stops mirroring further request/cleared frames', async () => {
    const client = createFakeClient()
    const store = createPanelStore(client)
    client.fire('request', makeRequest({ id: 'a' }))

    store.destroy()
    client.fire('request', makeRequest({ id: 'b' }))

    await expect(store.getSnapshot()).resolves.toEqual([makeRequest({ id: 'a' })])
  })
})
