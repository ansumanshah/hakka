---
title: Search DSL
description: Spec card — the typed search/filter grammar (scopes, regex/wildcard, negation, duration/size ranges, status DSL) shared by every host and the MCP server.
---

## What it does

The query engine parses a free-text search string into structured tokens (scope, mode,
negation), plus duration/size range filters and a status-code DSL, then compiles them into a
single predicate over `NetworkRequest`. A companion natural-language mapper (`nlToQuery`)
best-effort-translates an English phrase ("slow POSTs to /checkout") into the same DSL string.

## Public API

```ts
import {
  parseSearchTokens, parseRangeFilters, parseStatusDsl, compileQuery,
  sortRequests, groupRequests, createGroupCache, nlToQuery,
} from 'hakka-core'
import type { AdvancedQuery, SearchToken, SearchScope, SearchMode, SortField, SortOrder, GroupBy, RangeFilters } from 'hakka-core'

const { ranges, rest } = parseRangeFilters(raw) // strips dur>/size> tokens, returns the remainder
const tokens = parseSearchTokens(rest) // SearchToken[]
const predicate = compileQuery({ tokens, ...ranges, statusDsl, method, contentType, runtime })
requests.filter(predicate)

sortRequests(requests, field: SortField, order: SortOrder) // 'time' | 'duration' | 'size' | 'status'
groupRequests(requests, by: GroupBy) // 'host' | 'status' | 'method' | 'error' | 'trace' | 'none'

nlToQuery('failed requests to /users slower than 500ms') // → DSL string
```

## Grammar (verified against `query/parser.ts`)

| Token                                          | Meaning                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `url:` / `header:` (or `headers:`) / `body:`   | Scope prefix. Default scope (no prefix) is `all`.                                                     |
| `/pattern/`                                    | Regex mode.                                                                                           |
| `*glob*` or `?`                                | Wildcard mode.                                                                                        |
| `-token`                                       | Negate (only when there's content after the `-`).                                                     |
| `"quoted phrase"`                              | Kept as one token, spaces preserved.                                                                  |
| `dur>100` / `dur<500` / `dur>=`/`dur<=`        | Duration range, ms. `>`/`<` map to ±1 on the inclusive bound.                                         |
| `size>1kb` / `size<2mb`                        | Size range, bytes (`b`\|`kb`\|`mb`, default `b`).                                                     |
| `2xx`, `>=400`, `200..299`, `200..<300`, `404` | Status DSL (`parseStatusDsl`) — class notation, inclusive/exclusive range, comparison, or exact code. |

## Config keys + defaults

None — pure functions, no engine-level config. `search_requests` (hakka mcp) exposes the same
grammar via its `query` string param.

## Platform matrix

SPEC §5 row "Advanced search":

| Capability      | RN  | iOS | Android | Web | Mac app |
| --------------- | --- | --- | ------- | --- | ------- |
| Advanced search | ●   | ●   | ●       | ●   | ●       |

The parser/compiler/sort/group engine is core-TS, shared by RN, web, and `hakka mcp`'s
`search_requests`/`diagnose`/`generate_mocks` tools; iOS and Android ship equivalent native
search implementations.

## Wire format

None — operates on in-memory `NetworkRequest[]`. `hakka mcp`'s `search_requests` tool accepts
the DSL string as its `query` param over MCP's own JSON-RPC transport (not the bridge).

## Test anchors

- `packages/hakka-core/src/query/compile.test.ts`
- `packages/hakka-core/src/query/parser.test.ts`
- `packages/hakka-core/src/query/sortGroup.test.ts`
- `packages/hakka-core/src/search/nlToQuery.test.ts`

## Natural-language mapping (`nlToQuery`)

`nlToQuery` best-effort-translates a free-form English phrase ("failed requests", "slow POSTs
to /checkout") into the DSL grammar above — the same string `parseSearchTokens` /
`parseRangeFilters` / `compileQuery` consume. It's pure, with no DOM/runtime dependencies.

Output is a superset of the free-text DSL: everything the DSL already understands
(`url:`/`header:`/`body:` scopes, `/regex/`, `*glob*`, `-negation`, quoted phrases, and
`dur>`/`dur<`/`size>`/`size<` ranges) passes straight through. It additionally introduces two
prefix tokens mirroring the structured `status`/`method` filters already exposed by
`search_requests` (hakka mcp) and the web search bar — `status:<statusDsl>` (any form
`parseStatusDsl` accepts: `2xx`, `>=400`, `401`, `200..299`) and `method:<HTTP_METHOD>` — so a
single string can carry them. Callers extract these two prefixes the same way they already
extract `dur>`/`size>` ranges before handing the remainder to `parseSearchTokens`.

Matching is rule-ordered (more specific patterns first, e.g. "slower than 500ms" must win over
a bare "slow"): each rule runs against whatever text remains, consumes its matched span so a
later, more general rule can't re-match it, and appends its DSL fragment. Whatever text is left
over after every rule has run is stripped of punctuation and stopwords and appended as plain
substring terms (quoted if it contains a space) — unrecognised words are never silently
dropped, worst case they degenerate to a literal substring search.

## Limits & non-goals

- `nlToQuery` is a best-effort heuristic (ordered regex rules + stopword stripping), not an LLM
  call — ambiguous phrasing degenerates to a literal substring search rather than failing.
- No saved/recent-filter persistence in core — that's a per-host UI concern (SPEC §3 mentions
  "saved/recent filters" as a UI feature, not part of this engine).
- An invalid `/regex/` token compiles to a pattern that never matches (`/(?!)/`) rather than
  throwing — a malformed regex silently excludes everything instead of crashing the search.
