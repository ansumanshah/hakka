/**
 * RequestDetailViewModel — the view-model behind `<hakka-request-detail>`
 * (ADR 0003). Owns the one piece of `Detail.tsx`'s local state that is real
 * business logic, not ephemeral render state: resolving *which* request to
 * show (an object handed directly, or an id resolved against a store — ADR
 * 0003 (b)'s `request`-property-vs-`request-id`-attribute split), and
 * hydrating its full request/response bodies on demand (the main-thread
 * mirror is slim by default, so bodies are usually absent even when they
 * exist). A same-id reselect keeps the last-hydrated body on screen while a
 * fresh fetch is in flight; a different-id reselect blanks it immediately.
 * `tab`/`urlDecoded`/`copied` stay local Solid state — ephemeral render
 * toggles a future SwiftUI/Compose target wouldn't need to reproduce.
 */
import type { NetworkRequest } from 'hakka-core'

import type { ViewModel } from './contract'
import { createEmitter } from './emitter'

interface BodyPair {
  requestBody: string | null
  responseBody: string | null
}

export interface RequestDetailStore {
  getBody(id: string): Promise<BodyPair | null>
  getSnapshot(): Promise<NetworkRequest[]>
}

export interface RequestDetailState {
  /** The selected request, bodies merged in once hydration resolves. `null` before any selection. */
  request: NetworkRequest | null
}

export interface RequestDetailIntents {
  /** Select a request object directly — ADR 0003 (b)'s `request` property. Bypasses store resolution entirely. */
  selectRequest(req: NetworkRequest): void
  /** Select by id — ADR 0003 (b)'s `request-id` attribute, resolved against the injected store's snapshot. */
  selectRequestId(id: string): Promise<void>
  clear(): void
}

export type RequestDetailViewModel = ViewModel<RequestDetailState, RequestDetailIntents>

export interface RequestDetailViewModelOptions {
  /** Backs on-demand body hydration and `selectRequestId`. Omit for a fixed/test request that already carries full bodies. */
  store?: RequestDetailStore
}

export function createRequestDetailViewModel(opts: RequestDetailViewModelOptions = {}): RequestDetailViewModel {
  const { store } = opts
  const emitter = createEmitter()

  let latestReq: NetworkRequest | null = null
  let hydratedBody: { id: string; requestBody: string | null; responseBody: string | null } | null = null
  let fetchSeq = 0

  function snapshotRequest(): NetworkRequest | null {
    if (!latestReq) return null
    if (hydratedBody && hydratedBody.id === latestReq.id) {
      return { ...latestReq, requestBody: hydratedBody.requestBody, responseBody: hydratedBody.responseBody }
    }
    return latestReq
  }

  function hydrate(id: string): void {
    if (!store) return
    const seq = ++fetchSeq
    void store.getBody(id).then((bodies) => {
      if (seq !== fetchSeq || !bodies) return
      hydratedBody = { id, requestBody: bodies.requestBody, responseBody: bodies.responseBody }
      emitter.notify()
    })
  }

  function select(req: NetworkRequest): void {
    latestReq = req
    if (hydratedBody && hydratedBody.id !== req.id) hydratedBody = null
    fetchSeq++ // invalidate any fetch in flight from a previous selection
    emitter.notify()
    hydrate(req.id)
  }

  const intents: RequestDetailIntents = {
    selectRequest: select,
    async selectRequestId(id) {
      if (!store) {
        latestReq = null
        hydratedBody = null
        emitter.notify()
        return
      }
      const snap = await store.getSnapshot()
      const found = snap.find((r) => r.id === id) ?? null
      if (found) select(found)
      else {
        latestReq = null
        hydratedBody = null
        emitter.notify()
      }
    },
    clear() {
      latestReq = null
      hydratedBody = null
      fetchSeq++
      emitter.notify()
    },
  }

  return {
    getSnapshot: () => ({ request: snapshotRequest() }),
    subscribe: emitter.subscribe,
    intents,
  }
}
