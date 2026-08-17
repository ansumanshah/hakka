import { register, TAG } from 'hakka-browser/elements/request-detail'
import type { NetworkRequest } from 'hakka-core'

import { createElementWrapper } from './createElementWrapper'

/**
 * Props for `<RequestDetail>` — mirrors `<hakka-request-detail>`'s attribute/
 * property surface (`packages/hakka-browser/src/ui/elements/request-detail.tsx`).
 */
export interface RequestDetailProps {
  /** Resolved against the shared store singleton's snapshot. Ignored once `request` is set. */
  requestId?: string
  /** A whole `NetworkRequest`, injected directly — bypasses store resolution entirely. */
  request?: NetworkRequest | null
  /** Fires on `hakka:back` (detail is always an empty object). */
  onBack?: (detail: Record<string, never>) => void
}

/** Thin React wrapper over `<hakka-request-detail>`. */
export const RequestDetail = createElementWrapper<RequestDetailProps>(TAG, register, {
  onBack: 'hakka:back',
})
