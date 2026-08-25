import type { NetworkRequest } from 'hakka-core'

import type { HakkaRozeniteEventMap } from '../shared/protocol'

/** Narrow local subset of `RozeniteDevToolsClient<HakkaRozeniteEventMap>`
 * (`@rozenite/plugin-bridge`) — a plain in-memory fake satisfies it exactly,
 * which is what makes `createHakkaRozeniteBridge` unit-testable without a
 * real RN DevTools session. */
export interface RozeniteClientLike {
  send<TType extends keyof HakkaRozeniteEventMap>(type: TType, payload: HakkaRozeniteEventMap[TType]): void
  onMessage<TType extends keyof HakkaRozeniteEventMap>(
    type: TType,
    listener: (payload: HakkaRozeniteEventMap[TType]) => void,
  ): { remove(): void }
}

/** The slice of `Hakka`'s public API (`hakka-core`) this bridge subscribes to. */
export interface HakkaFacadeLike {
  /** Newest-first, per `hakka-core`'s own `HakkaFacade.getLogs()` contract. */
  getLogs(): NetworkRequest[]
  onRequest(listener: (request: NetworkRequest) => void): () => void
  clearLogs(): void
}

/**
 * Wires a Rozenite client to `Hakka`'s capture stream. Re-flushes the backlog
 * on `get-snapshot` to cover a DevTools reload where the panel remounts but
 * this effect never tore down.
 */
export function createHakkaRozeniteBridge(client: RozeniteClientLike, hakka: HakkaFacadeLike): () => void {
  function flushBacklog(): void {
    // `getLogs()` is newest-first, but each frame is sent as a separate,
    // sequentially-processed message and the panel side (`panelStore.ts`)
    // upserts every incoming request by *prepending* it. Sending newest-first
    // would therefore reconstruct the backlog oldest-first on the panel — send
    // oldest-first here so the repeated prepends land back in the newest-first
    // order the panel's store contract promises.
    for (const request of [...hakka.getLogs()].reverse()) {
      client.send('request', request)
    }
  }

  flushBacklog()

  const unsubscribeRequests = hakka.onRequest((request) => {
    client.send('request', request)
  })

  const snapshotSubscription = client.onMessage('get-snapshot', flushBacklog)

  const clearSubscription = client.onMessage('clear', () => {
    hakka.clearLogs()
    client.send('cleared', {})
  })

  return () => {
    unsubscribeRequests()
    snapshotSubscription.remove()
    clearSubscription.remove()
  }
}
