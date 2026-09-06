import type { NetworkRequest } from 'hakka-core'

import type { HakkaRozeniteEventMap } from '../shared/protocol'

/** Narrow local subset of `RozeniteDevToolsClient<HakkaRozeniteEventMap>`
 * (`@rozenite/plugin-bridge`) — a plain fake satisfies it, so
 * `createPanelStore` is unit-testable without a real Rozenite channel. */
export interface PanelStoreClientLike {
  send<TType extends keyof HakkaRozeniteEventMap>(type: TType, payload: HakkaRozeniteEventMap[TType]): void
  onMessage<TType extends keyof HakkaRozeniteEventMap>(
    type: TType,
    listener: (payload: HakkaRozeniteEventMap[TType]) => void,
  ): { remove(): void }
}

/** The runtime shape `hakka-browser/react`'s `<RequestList store>`/`<FilterBar
 * store>` actually call (`store.subscribe`/`getSnapshot` always,
 * `clear`/`ingest` only from the list's "Clear"/"Load sample traffic"
 * actions). Both components type `store` as `unknown`, so nothing downstream
 * checks this at compile time — it exists so this file's own implementation
 * is checked against something. */
export interface PanelStore {
  getSnapshot(): Promise<NetworkRequest[]>
  subscribe(cb: (request: NetworkRequest) => void): () => void
  clear(): void
  ingest(request: NetworkRequest): void
  /** Fires when the mirror was emptied by a `cleared` ack from the RN side
   * (its own Clear button, or a remote `Hakka.clearLogs()` call never routed
   * through this panel) — deliberately a separate channel from `subscribe`,
   * whose callback is fed a real `NetworkRequest` for every call
   * (`hakka-browser`'s `RequestListViewModel` upserts it into its own mirror
   * unconditionally); nothing about "everything's gone" can travel over that
   * channel without a fake payload corrupting that mirror. Not part of
   * `hakka-browser/elements`' store contract — used only by this panel's own
   * `ui/App.tsx` mirror. */
  onClear(cb: () => void): () => void
  /** Not part of `hakka-browser/elements`' store contract — called from the
   * panel's own unmount effect. */
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
