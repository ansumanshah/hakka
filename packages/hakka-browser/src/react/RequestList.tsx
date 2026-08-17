import { register, TAG } from 'hakka-browser/elements/request-list'
import type { GroupBy } from 'hakka-core'

import { createElementWrapper } from './createElementWrapper'

/**
 * Props for `<RequestList>` — mirrors `<hakka-request-list>`'s attribute/
 * property surface (`packages/hakka-browser/src/ui/elements/request-list.tsx`).
 */
export interface RequestListProps {
  /** Row-density toggle. */
  compact?: boolean
  /** Seeds the shared `SelectionViewModel` singleton once, on connect. */
  selectMode?: boolean
  /** Seeds the shared `FilterViewModel` singleton once, on connect. */
  groupBy?: GroupBy
  traceView?: boolean
  /** Injected `StoreClient`-shaped object — bypasses the shared store
   * singleton. Untyped since `StoreClient` isn't part of the public exports
   * yet; passes straight through as a DOM property. */
  store?: unknown
  /** A full `RequestListViewModel` — bypasses `store`/the shared `FilterViewModel` entirely. */
  viewModel?: unknown
  /** Fires on `hakka:select`. */
  onSelect?: (detail: { id: string }) => void
}

/** Thin React wrapper over `<hakka-request-list>`. See the package README for a usage example. */
export const RequestList = createElementWrapper<RequestListProps>(TAG, register, {
  onSelect: 'hakka:select',
})
