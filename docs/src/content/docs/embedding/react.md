---
title: React
description: Reference for hakka-browser/react — thin React 19 wrappers over hakka-browser/elements' six standalone network-inspector custom elements.
---

`hakka-browser/react` ships one thin React 19 component per
[`hakka-browser/elements`](/embedding/components/) element — `<RequestList>`, `<RequestDetail>`,
`<Waterfall>`, `<FilterBar>`, `<Stats>`, `<JsonTree>` — with typed props and `onX` callback
props instead of raw DOM attributes and `addEventListener`.

Reach for this subpath instead of `hakka-browser/elements` directly whenever you're already in a
React 19 app: it saves you the manual `ref` + `addEventListener` wiring a custom event like
`hakka:select` otherwise needs. If you're not on React, use
[`hakka-browser/elements`](/embedding/components/) directly. For composition recipes (pairing a
list with a detail view, feeding a waterfall from a CI report), see
[Build your own devtools](/guides/build-your-own-devtools/).

## Install

```sh
bun add hakka-browser
```

Peer dependencies: `react` and `react-dom`, both `>=19.2.3`.

## Usage

```tsx
import { RequestList } from 'hakka-browser/react'

function Inspector() {
  return <RequestList onSelect={({ id }) => console.log('selected', id)} store={myStoreClient} />
}
```

Registration is automatic — each component calls the underlying element's `register()` from a
`useEffect`, i.e. only on the client, after mount. React effects never run during server
rendering, so this is SSR-safe even though `register()` itself depends on browser globals.

## Component reference

| Component         | Underlying element       | Props                                                                                                                             | Event prop                                            |
| ----------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `<RequestList>`   | `<hakka-request-list>`   | `compact?: boolean`, `selectMode?: boolean`, `groupBy?: GroupBy`, `traceView?: boolean`, `store?: unknown`, `viewModel?: unknown` | `onSelect?: (detail: { id: string }) => void`         |
| `<RequestDetail>` | `<hakka-request-detail>` | `requestId?: string`, `request?` (`NetworkRequest`, nullable)                                                                     | `onBack?: (detail: Record<string, never>) => void`    |
| `<Waterfall>`     | `<hakka-waterfall>`      | `group` (`RequestGroup`, required prop, value may be `null`), `selectedId?` (string, nullable)                                    | `onSelect?: (detail: { id: string }) => void`         |
| `<FilterBar>`     | `<hakka-filter-bar>`     | `nlMode?: boolean`, `advancedOpen?: boolean`, `store?: unknown`, `viewModel?: unknown`                                            | `onFilterChange?: (detail: HakkaSavedFilter) => void` |
| `<Stats>`         | `<hakka-stats>`          | `store?: unknown`, `viewModel?: unknown`                                                                                          | —                                                     |
| `<JsonTree>`      | `<hakka-json-tree>`      | `maxDepth?: number`, `value?: unknown`, `text?` (string, nullable)                                                                | —                                                     |

Every prop maps 1:1 onto the underlying element's attribute/property surface documented on the
[components reference page](/embedding/components/) — camelCased (`selectMode` →
`select-mode`, `groupBy` → `group-by`, and so on). `RequestList`'s `groupBy`/`selectMode` and
`FilterBar`'s `nlMode`/`advancedOpen` are seed-once against the shared singleton, exactly as
described there.

`HakkaSavedFilter` (the `onFilterChange` detail shape) is exported from `hakka-browser/react` and
mirrors `hakka-browser`'s internal `SavedFilter` type field-for-field:

```ts
interface HakkaSavedFilter {
  filterText: string
  filterMethod: string
  filterStatus: string
  filterContentType: string
  filterRuntime: string
  sortField: string
  sortOrder: string
  groupBy: string
  durMin?: number
  durMax?: number
  sizeMinKb?: number
  sizeMaxKb?: number
}
```

## The interop contract

- **Properties/attributes pass through React's native custom-element path.** Every prop other
  than an `onX` callback forwards straight to `React.createElement`, which React 19 assigns as
  a real DOM _property_ when the underlying element declares it (it always does — every object
  property on these six elements is pre-declared in its `customElement()` props spec) and falls
  back to a stringified attribute otherwise. No imperative prop plumbing in this package —
  `store`/`viewModel`/`group`/`request` all work as plain JSX props, no ref escape hatch
  needed.
- **Events are never bound through React's own `onX` props.** React lowercases the entire
  suffix after `on` (`onHakkaSelect` would bind to the DOM event `'hakkaselect'`), and these
  elements dispatch colon-namespaced events (`hakka:select`) — a prop name can't contain a
  colon at all. Every `onX` prop is instead bound via `ref.addEventListener('hakka:x', ...)` in
  one shared `createElementWrapper` helper, rebound on each render and cleaned up on unmount.
- **`ref` exposes the underlying custom element** — an `HTMLElement`, not a React component
  instance.

This is deliberately the same restraint any thin React wrapper over a third-party web
component uses (a `<video>` tag, a Stripe Element): the wrapper never imports `solid-js`, never
creates a Solid reactive root, and never re-renders the element's internal tree in response to
React state. It talks to the element exclusively through its public DOM surface.

## Known limitations

`store`/`viewModel` escape-hatch props are typed `unknown` on every component that has them.
Their real shapes (`StoreClient`, `RequestListViewModel`, `FilterViewModel`, `StatsViewModel`)
live in `hakka-browser`'s internal source tree and aren't part of `hakka-browser/elements`'s public type
exports yet — pass through whatever value you already have a handle to; it reaches the
underlying element as a real object property either way.

## See also

- [Components](/embedding/components/) — the underlying custom elements and their full
  attribute/property/event surface.
- [Build your own devtools](/guides/build-your-own-devtools/) — composition recipes using these
  elements (via the script-tag/ESM path, not React) alongside the React tab's own example.
- [Rozenite](/embedding/rozenite/) — these same wrappers, rendered inside a React Native
  DevTools panel.
