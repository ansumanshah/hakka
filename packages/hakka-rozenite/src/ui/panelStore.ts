import type { NetworkRequest } from 'hakka-core'

import type { HakkaRozeniteEventMap } from '../shared/protocol'

/** Messaging used to mirror device traffic into the panel. */
export interface PanelStoreClientLike {
  send<TType extends keyof HakkaRozeniteEventMap>(type: TType, payload: HakkaRozeniteEventMap[TType]): void
  onMessage<TType extends keyof HakkaRozeniteEventMap>(
    type: TType,
    listener: (payload: HakkaRozeniteEventMap[TType]) => void,
  ): { remove(): void }
}

export interface PanelStore {
  getSnapshot(): Promise<NetworkRequest[]>
  subscribe(cb: (request: NetworkRequest) => void): () => void
  clear(): void
  ingest(request: NetworkRequest): void
  /** Clear acknowledgements have a separate channel: request subscribers
   * always receive a real record to upsert. */
  onClear(cb: () => void): () => void
  destroy(): void
}

/** Newest-first request mirror. Updates retain their original insertion position. */
export function createPanelStore(client: PanelStoreClientLike): PanelStore {
  const requests = new Map<string, NetworkRequest>()
  const subscribers = new Set<(request: NetworkRequest) => void>()
  const clearListeners = new Set<() => void>()

  function upsert(request: NetworkRequest): void {
    requests.set(request.id, request)
    for (const subscriber of subscribers) subscriber(request)
  }

  const requestSubscription = client.onMessage('request', upsert)
  const clearedSubscription = client.onMessage('cleared', () => {
    requests.clear()
    for (const listener of clearListeners) listener()
  })

  // Resync on mount: ask the RN side to resend its backlog immediately.
  client.send('get-snapshot', {})

  return {
    async getSnapshot() {
      const snapshot = new Array<NetworkRequest>(requests.size) // oxlint-disable-line unicorn/no-new-array
      let index = snapshot.length
      for (const request of requests.values()) snapshot[--index] = request
      return snapshot
    },
    subscribe(cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    onClear(cb) {
      clearListeners.add(cb)
      return () => clearListeners.delete(cb)
    },
    clear() {
      requests.clear()
      client.send('clear', {})
    },
    // Sample traffic stays in the local panel mirror.
    ingest: upsert,
    destroy() {
      requestSubscription.remove()
      clearedSubscription.remove()
    },
  }
}
