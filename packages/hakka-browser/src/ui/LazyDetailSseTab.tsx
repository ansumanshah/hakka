import type { NetworkRequest } from 'hakka-core'
import { lazy, Loading } from 'solid-js'
import type { Component } from 'solid-js'

/**
 * Code-split wrapper for the SSE tab — the event parser and the provider
 * assemblers load as their own chunk the first time an event-stream response
 * is inspected, keeping them out of the inspector's main UI chunk (the
 * LazyJsonViewer precedent).
 */
const DetailSseTabInner = lazy(() => import('./DetailSseTab').then((m) => ({ default: m.DetailSseTab })))

interface DetailSseTabProps {
  req: NetworkRequest
  /** Raw response-body accessor backed by the store's getBody round-trip (see Detail.tsx's bodyAsync). */
  body: () => string | null | undefined
}

export const LazyDetailSseTab: Component<DetailSseTabProps> = (props) => (
  <Loading fallback={<p class="hakka-empty-hint">Loading events…</p>}>
    <DetailSseTabInner req={props.req} body={props.body} />
  </Loading>
)
