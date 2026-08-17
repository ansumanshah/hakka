import { describe, expect, it } from 'vitest'

import type { HakkaRozeniteEventMap } from '../../shared/protocol'
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

const REQ_A: FakeRequest = { id: 'a', url: 'https://example.com/a', method: 'GET' }
const REQ_B: FakeRequest = { id: 'b', url: 'https://example.com/b', method: 'POST' }

describe('createHakkaRozeniteBridge', () => {
  it('flushes the existing backlog as individual request frames on wire-up', () => {
    const client = createFakeClient()
    const { facade } = createFakeHakka([REQ_B, REQ_A]) // newest-first, per getLogs()'s contract

    createHakkaRozeniteBridge(client, facade)

    expect(client.sent).toEqual([
      { type: 'request', payload: REQ_B },
      { type: 'request', payload: REQ_A },
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
