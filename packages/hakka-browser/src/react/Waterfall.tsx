import { register, TAG } from 'hakka-browser/elements/waterfall'
import type { RequestGroup } from 'hakka-core'

import { createElementWrapper } from './createElementWrapper'

/**
 * Props for `<Waterfall>` — mirrors `<hakka-waterfall>`'s attribute/property
 * surface (`packages/hakka-browser/src/ui/elements/waterfall.tsx`). Renders a "No group
 * provided" fallback if `group` is `null`.
 */
export interface WaterfallProps {
  /** The trace group to render (required). */
  group: RequestGroup | null
  selectedId?: string | null
  /** Fires on `hakka:select`. */
  onSelect?: (detail: { id: string }) => void
}

/** Thin React wrapper over `<hakka-waterfall>`. */
export const Waterfall = createElementWrapper<WaterfallProps>(TAG, register, {
  onSelect: 'hakka:select',
})
