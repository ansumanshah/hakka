import { register, TAG } from 'hakka-browser/elements/stats'

import { createElementWrapper } from './createElementWrapper'

/**
 * Props for `<Stats>` — mirrors `<hakka-stats>`'s property surface
 * (`packages/hakka-browser/src/ui/elements/stats.tsx`). No attributes, no events —
 * pure display.
 */
export interface StatsProps {
  /** Injected `StoreClient`-shaped object — bypasses the shared store singleton. */
  store?: unknown
  /** A full `StatsViewModel` — bypasses `store` entirely. */
  viewModel?: unknown
}

/** Thin React wrapper over `<hakka-stats>`. */
export const Stats = createElementWrapper<StatsProps>(TAG, register, {})
