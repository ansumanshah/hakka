import { register, TAG } from 'hakka-browser/elements/json-tree'

import { createElementWrapper } from './createElementWrapper'

/**
 * Props for `<JsonTree>` — mirrors `<hakka-json-tree>`'s attribute/property
 * surface (`packages/hakka-browser/src/ui/elements/json-tree.tsx`). No events — pure
 * display. `value` wins when both `value` and `text` are set.
 */
export interface JsonTreeProps {
  /** Depth at which nodes render collapsed. Defaults to 2. */
  maxDepth?: number
  /** Any JSON-shaped value, serialized before reaching the underlying viewer. Wins over `text` when both are set. */
  value?: unknown
  /** Raw JSON string. */
  text?: string | null
}

/** Thin React wrapper over `<hakka-json-tree>`. */
export const JsonTree = createElementWrapper<JsonTreeProps>(TAG, register, {})
