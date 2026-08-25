import { describe, expect, it } from 'vitest'

import type { HakkaRozeniteEventMap } from '../../shared/protocol'
import { createPanelStore } from '../../ui/panelStore'
import type { PanelStoreClientLike } from '../../ui/panelStore'
import { createHakkaRozeniteBridge } from '../bridge'
import type { HakkaFacadeLike, RozeniteClientLike } from '../bridge'

interface FakeRequest {
  id: string
  url: string
  method: string
}

/** A minimal in-memory stand-in for `RozeniteDevToolsClient` — records every
 * `send()` and lets tests fire `onMessage` listeners directly, with no real
 * Rozenite channel (CDP domain / `postMessage`) involved. */
function createFakeClient(): RozeniteClientLike & {
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

/** A minimal in-memory stand-in for the `Hakka` facade — a fixed backlog plus
 * a subscriber list `emit()` drives directly, mirroring `hakka-core`'s real
 * `onRequest`/`getLogs`/`clearLogs` contract closely enough to exercise the
 * bridge without importing the real singleton. */
function createFakeHakka(initialLogs: FakeRequest[] = []) {
  let logs = [...initialLogs]
  const listeners = new Set<(request: FakeRequest) => void>()
  let clearCount = 0

  return {
    facade: {
      getLogs: () => logs,
      onRequest: (listener: (request: FakeRequest) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      clearLogs: () => {
        clearCount++
        logs = []
      },
    } as unknown as HakkaFacadeLike,
    emit(request: FakeRequest) {
      logs = [request, ...logs]
      for (const listener of listeners) listener(request as never)
    },
    get clearCount() {
      return clearCount
    },
    get logs() {
      return logs
    },
  }
}

/**
 * Wires two `send`/`onMessage` ends together in-process, so a `send()` on one
 * side reaches the other side's `onMessage` listeners — a minimal stand-in
 * for the real RN<->panel Rozenite channel, used only to exercise the
 * combined backlog-replay path end-to-end (`createHakkaRozeniteBridge`'s
 * `flushBacklog` feeding `createPanelStore`'s prepend-on-upsert).
 */
function createLinkedClients(): [RozeniteClientLike, PanelStoreClientLike] {
  const deviceListeners = new Map<string, Set<(payload: unknown) => void>>()
  const panelListeners = new Map<string, Set<(payload: unknown) => void>>()

  function makeEnd(
    ownListeners: Map<string, Set<(payload: unknown) => void>>,
    peerListeners: Map<string, Set<(payload: unknown) => void>>,
  ) {
    return {
      send(type: string, payload: unknown) {
        for (const listener of peerListeners.get(type) ?? []) listener(payload)
      },
      onMessage(type: string, listener: (payload: unknown) => void) {
        const set = ownListeners.get(type) ?? new Set()
        set.add(listener)
        ownListeners.set(type, set)
        return { remove: () => set.delete(listener) }
      },
    }
  }

  return [
    makeEnd(deviceListeners, panelListeners) as RozeniteClientLike,
    makeEnd(panelListeners, deviceListeners) as PanelStoreClientLike,
  ]
}

const REQ_A: FakeRequest = { id: 'a', url: 'https://example.com/a', method: 'GET' }
const REQ_B: FakeRequest = { id: 'b', url: 'https://example.com/b', method: 'POST' }

describe('createHakkaRozeniteBridge', () => {
  it('flushes the existing backlog oldest-first, so panelStore prepends reconstruct newest-first', () => {
    const client = createFakeClient()
    const { facade } = createFakeHakka([REQ_B, REQ_A]) // newest-first, per getLogs()'s contract

    createHakkaRozeniteBridge(client, facade)

    // Sent oldest-first (REQ_A then REQ_B): the panel's store upserts each
    // arriving frame via prepend, so sending in this order is what leaves the
    // panel's own list newest-first (REQ_B, REQ_A) — see panelStore.test.ts's
    // matching backlog-replay case for that side of the contract.
    expect(client.sent).toEqual([
      { type: 'request', payload: REQ_A },
      { type: 'request', payload: REQ_B },
    ])
  })

  it('forwards each live request as it arrives', () => {
    const client = createFakeClient()
    const { facade, emit } = createFakeHakka()

    createHakkaRozeniteBridge(client, facade)
    emit(REQ_A)
    emit(REQ_B)

    expect(client.sent).toEqual([
      { type: 'request', payload: REQ_A },
      { type: 'request', payload: REQ_B },
    ])
  })

  it('re-flushes the backlog when the panel asks for get-snapshot', () => {
    const client = createFakeClient()
    const { facade, emit } = createFakeHakka()

    createHakkaRozeniteBridge(client, facade)
    emit(REQ_A)
    client.sent.length = 0 // discard the initial-flush + live-forward frames above

    client.fire('get-snapshot', {})

    expect(client.sent).toEqual([{ type: 'request', payload: REQ_A }])
  })

  it('clearLogs() runs exactly once per clear message and is acked', () => {
    const client = createFakeClient()
    const fake = createFakeHakka()

    createHakkaRozeniteBridge(client, fake.facade)
    fake.emit(REQ_A)
    client.sent.length = 0

    client.fire('clear', {})

    expect(fake.clearCount).toBe(1)
    expect(fake.logs).toEqual([])
    expect(client.sent).toEqual([{ type: 'cleared', payload: {} }])
  })

  it('the returned teardown unsubscribes live requests, get-snapshot, and clear', () => {
    const client = createFakeClient()
    const fake = createFakeHakka()

    const teardown = createHakkaRozeniteBridge(client, fake.facade)
    client.sent.length = 0
    teardown()

    fake.emit(REQ_A)
    client.fire('get-snapshot', {})
    client.fire('clear', {})

    expect(client.sent).toEqual([])
    expect(fake.clearCount).toBe(0)
  })
})

describe('createHakkaRozeniteBridge + createPanelStore (combined replay)', () => {
  it('backlog replay lands newest-first on the panel side, matching its documented store contract', async () => {
    const [deviceClient, panelClient] = createLinkedClients()
    const { facade } = createFakeHakka([REQ_B, REQ_A]) // newest-first, per getLogs()'s contract

    // Panel side wires up (and registers its 'request' listener) first, same
    // as real mount order — the panel is what asks the device to (re)connect.
    const store = createPanelStore(panelClient)
    createHakkaRozeniteBridge(deviceClient, facade)

    // getLogs() handed the bridge [REQ_B, REQ_A] (newest-first); the panel's
    // own mirror must come out the same way, not reversed by the replay.
    await expect(store.getSnapshot()).resolves.toEqual([REQ_B, REQ_A])
  })
})
