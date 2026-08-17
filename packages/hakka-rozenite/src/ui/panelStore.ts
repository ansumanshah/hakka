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
  /** Not part of `hakka-browser/elements`' store contract — called from the
   * panel's own unmount effect. */
  destroy(): void
}

/**
 * Builds the panel-side capture mirror fed by `HakkaRozeniteEventMap`
 * messages from the RN side (`react-native/bridge.ts`), injected as the
 * `store` prop into `hakka-browser/react`'s `<RequestList>`/`<FilterBar>` in
 * `ui/App.tsx`. Deliberately not `hakka-browser/elements`' own shared store
 * singleton, which belongs to `hakka-browser`'s worker-backed engine this
 * plugin never touches — this is a separate mirror fed purely by Rozenite
 * messaging.
 *
 * Requests are newest-first, matching `hakka-core`'s `Hakka.getLogs()`
 * convention, and upsert by `id` so a later frame for an in-flight request
 * replaces its earlier entry rather than adding a duplicate row.
 */
export function createPanelStore(client: PanelStoreClientLike): PanelStore {
  let requests: NetworkRequest[] = []
  const subscribers = new Set<(request: NetworkRequest) => void>()

  function upsert(request: NetworkRequest): void {
    const index = requests.findIndex((r) => r.id === request.id)
    requests = index >= 0 ? requests.map((r, i) => (i === index ? request : r)) : [request, ...requests]
    for (const subscriber of subscribers) subscriber(request)
  }

  const requestSubscription = client.onMessage('request', upsert)
  const clearedSubscription = client.onMessage('cleared', () => {
    requests = []
  })

  // Resync on mount: ask the RN side to resend its backlog immediately.
  client.send('get-snapshot', {})

  return {
    getSnapshot: () => Promise.resolve(requests),
    subscribe(cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },
    clear() {
      requests = []
      client.send('clear', {})
    },
    ingest(request) {
      // "Load sample traffic" empty-state action — never forwarded to the
      // device, this plugin has no synthetic demo-data source of its own.
      upsert(request)
    },
    destroy() {
      requestSubscription.remove()
      clearedSubscription.remove()
    },
  }
}
