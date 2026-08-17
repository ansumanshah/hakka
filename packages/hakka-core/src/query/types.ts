/**
 * Query / search / sort / group types for the platform-neutral Hakka query engine.
 * Used by RN, iOS, Android, and web — no DOM or browser-only deps.
 */

/** Which field(s) of a request to search against. */
export type SearchScope = 'url' | 'header' | 'body' | 'all'

/** How the search value is interpreted. */
export type SearchMode = 'substring' | 'wildcard' | 'regex'

/** Field to sort by. */
export type SortField = 'time' | 'duration' | 'size' | 'status'

/** Sort direction. */
export type SortOrder = 'asc' | 'desc'

/** How to group results. */
export type GroupBy = 'host' | 'status' | 'method' | 'error' | 'trace' | 'none'

/** A single parsed token from the search bar query string. */
export interface SearchToken {
  scope: SearchScope
  mode: SearchMode
  value: string
  /** When true the token must NOT match for the request to pass. */
  negate: boolean
}

/** The fully-parsed query representation consumed by `compileQuery`. */
export interface AdvancedQuery {
  /** Free-text tokens with scope/mode/negate semantics. */
  tokens?: SearchToken[]
  /** Status DSL string ("2xx", ">=400", "200..299", …). */
  statusDsl?: string
  /** Exact HTTP method filter (case-insensitive). */
  method?: string
  /** Substring match against the response content-type header. */
  contentType?: string
  /** Exact runtime filter ("client" | "server" | "edge"). */
  runtime?: string
  /** Field to sort by. */
  sort?: SortField
  /** Sort direction. */
  order?: SortOrder
  /** How to group results. */
  group?: GroupBy
  /** Minimum request duration in milliseconds (inclusive). */
  durationMin?: number
  /** Maximum request duration in milliseconds (inclusive). */
  durationMax?: number
  /** Minimum total body size in bytes (inclusive). Total = (requestBodySize ?? 0) + (responseBodySize ?? 0). */
  sizeMin?: number
  /** Maximum total body size in bytes (inclusive), same total formula as `sizeMin`. */
  sizeMax?: number
}
