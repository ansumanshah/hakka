// Shared shape of the Request/Response tabs' body area: a headers table
// followed by a stale-content-revalidating body viewer. Both tabs feed this
// the exact same `bodyAsync()` resource (see Detail.tsx) through the
// `pendingSource` accessor, so `isPending` reflects one shared in-flight
// fetch, not two independent ones.
import type { Component } from 'solid-js'
import { isPending, Loading, Show } from 'solid-js'

import { BodySearch } from './DetailBodySearch'
import { HeadersTable } from './DetailShared'

interface DetailBodyRegionProps {
  headers: Record<string, string> | undefined
  headersTitle: string
  noBodyLabel: string
  /** Decoded body accessor — called inside the <Loading> boundary below so
   * the async read (and its stale-content revalidation) stays scoped here. */
  body: () => string | null | undefined
  /** The same async resource the body accessor reads, passed separately so
   * `isPending` tracks it directly rather than through a derived memo. */
  pendingSource: () => unknown
}

export const DetailBodyRegion: Component<DetailBodyRegionProps> = (props) => (
  <>
    <HeadersTable headers={props.headers} title={props.headersTitle} />
    {/* <Loading> gives stale-content revalidation for free here — see the
        bodyAsync() comment in Detail.tsx; fallback={null} only fires on the
        very first body this Detail instance ever shows. */}
    <Loading fallback={null}>
      <div class={`hakka-body-region${isPending(props.pendingSource) ? ' hakka-body-pending' : ''}`}>
        <Show when={props.body()} fallback={<p class="hakka-empty-hint">{props.noBodyLabel}</p>}>
          <BodySearch text={props.body()} />
        </Show>
      </div>
    </Loading>
  </>
)
