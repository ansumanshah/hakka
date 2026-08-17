---
title: 'ADR 0003 — Embeddable components (P5 founding ADR)'
description: Six framework-agnostic custom elements extracted from the Hakka Inspector shell, shipped as hakka-components (elements) and hakka-react (wrapper).
---

Status: Implemented · Date: 2026-07-11 · Amended by [ADR 0007](/contributing/adr/0007-solid-2-rc/)

> **Amendment (2026-08-16, ADR 0007):** the element machinery moved from
> Solid 1.x's `solid-element` to Solid 2.0's `@solidjs/element`, and the
> compiler from `vite-plugin-solid` to `@solidjs/vite-plugin`. References to
> `solid-element` below are the historical record of the original
> implementation; the architecture, tags, props/events contract, and
> registration guarantees they describe are unchanged.

## Context

F2 already proved one seam: `packages/hakka-browser/src/ui/mount.tsx`'s `mount(el,
{panel}) → MountHandle` renders the _entire_ Inspector shell — tabs, filters,
Detail, Settings, theming — into a host element instead of the floating
overlay, sharing styles, persisted state, and the theme-root registry
(`presets.ts`) with any floating panel already on the page. It proves hosts
want Hakka's UI inside their own layout, not just as a toggleable overlay.
What it doesn't prove is the next thing being asked for: a host that wants
_one piece_ — just the request list, just the JSON tree — without the tab
shell, the command palette, the toggle button, or the worker-backed capture
engine around it.

Two outside signals make that demand concrete rather than speculative.
An internal design audit for a planned desktop companion app — an API
client, not an inspector — inventories Hakka's own
`packages/hakka-browser/src/ui` against that host and finds four components reusable as-is (`JsonViewer.tsx` +
`LazyJsonViewer.tsx`, `CommandPalette.tsx`, `Detail.tsx`'s `HeadersTable`,
`Detail.tsx`'s `TimingBar`), four that need a variant (`RequestRow.tsx`,
`RequestList.tsx`'s windowing, `Detail.tsx`'s `HeadersTable` again as an
editable form, `JsonViewer.tsx`'s token coloring), and seven genuinely new.
That 4/4/7 split is direct evidence these pieces already generalize past the
Inspector shell they grew up inside — that host needs them without needing
`Hakka.use()`, the worker store, or the floating toggle button. Separately,
an internal refactor survey flags `Inspector.tsx` (1574 lines at
survey time, since grown) as a god-file whose filter state, drag state,
selection mode, diff-pair state, command-palette state, tour state, and
saved-filter state are all local signals inside one component, with an
extraction list already named: `useFilterState`, `useDragPosition`,
`useSelectionMode`, `useDiffPair`, `useCommandPaletteState`, `useTourState`,
`useSavedFilters`. That list matters here for a reason the rename map itself
wasn't written to address: several of those hooks are exactly the state a
standalone component needs to own to work outside the shell, and today that
state doesn't exist as anything ownable — it's signals closed over inside one
1500+-line function.

**The framework decision is pre-decided, not re-opened by this ADR.** Views
stay SolidJS source, compiled to standard custom elements via `solid-element`
(already a `hakka-web` devDependency, already the exact mechanism
`register.ts` uses today for `<hakka-inspector>`). A headless view-model
layer sits between Solid and the six components, so the state contract is
platform-neutral rather than Solid-specific. A thin React wrapper package
adapts the resulting custom elements for React consumers. Distribution is
npm-only: `hakka-components` (the elements) and `hakka-react`
(the wrapper). Copy-paste distribution through NoodleUI's own registry was
considered and dropped — NoodleUI's registry model assumes React source a
consumer's tooling copies verbatim into their repo; Hakka's actual
implementation is Solid, and there is no such thing as "copy-paste this Solid
component into your React app and have it work like a React component."
Building and maintaining a second, hand-written React reimplementation just to
keep copy-paste parity would be the exact double-maintenance problem this ADR
otherwise designs around (see (c)), at higher stakes. This ADR records that
decision and works out its consequences; it does not relitigate Solid vs.
React vs. copy-paste.

**Six v1 elements**, one per existing web UI component, chosen because they
are exactly the pieces both signals above point at: `<hakka-request-list>`
(`RequestList.tsx`), `<hakka-request-detail>` (`Detail.tsx`),
`<hakka-waterfall>` (`TraceWaterfall.tsx`), `<hakka-filter-bar>`
(`FilterBar.tsx`), `<hakka-stats>` (`StatsTab.tsx`), `<hakka-json-tree>`
(`JsonViewer.tsx`).

## Decisions

### (a) The headless view-model contract

**Chosen — one view-model per component, contract shape `{ getSnapshot(),
subscribe(listener), intents }`.** This is not a new idea invented for this
ADR: `packages/hakka-browser/src/worker/storeClient.ts`'s `StoreClient` interface
already exposes `getSnapshot(query?): Promise<NetworkRequest[]>` and
`subscribe(cb): () => void`, and every panel (`StatsTab.tsx` calls
`store().getSnapshot()` then `store().subscribe(...)` directly) already
depends on that exact shape. It is also, not coincidentally, the shape of
React's own `useSyncExternalStore` (`subscribe`, `getSnapshot`) — a contract
that was designed precisely so a UI framework can consume an external,
framework-agnostic store without tearing. Reusing it here means the contract
this ADR defines is not a new invention to learn; it is a name for something
Hakka's own code already trusts, generalized one level.

```
interface ViewModel<State, Intents> {
  getSnapshot(): State
  subscribe(listener: () => void): () => void
  intents: Intents
}
```

`getSnapshot()` is synchronous (unlike `StoreClient.getSnapshot()`, which is
`Promise`-returning because it may cross a Worker boundary) — a view-model's
snapshot is always an in-memory derived value, never itself an RPC; it may
_read from_ an async store underneath, but the contract's own snapshot call
never awaits. `subscribe`'s listener fires once per logical state change, not
once per internal signal write — the same microtask-batching discipline
`Inspector.tsx`'s `applyUpsertBatch`/`flushUpsertBuffer` already applies to
store upserts extends to view-model intents, so a burst of rapid calls (e.g.
typing into the filter box) collapses to one notification per flush, not one
per keystroke. There is no selector or memoization API at the contract level
— that is each platform's own rendering layer's job (Solid's `createMemo` for
the web elements, whatever P7's SwiftUI/Compose targets use natively).

**Doubles as the P7/native contract.** Nothing in the shape above mentions
Solid. `getSnapshot`/`subscribe`/`intents` is implementable by a SwiftUI
`ObservableObject` (snapshot = `@Published` state, subscribe = Combine's own
subscription machinery) or a Jetpack Compose `StateFlow` (snapshot = current
value, subscribe = `collect`) without either platform knowing a Solid signal
exists anywhere. Solid signals are the _internal_ implementation detail of
the six web view-models only; the contract is what a future native
implementation targets.

**One view-model per component, not one shared store facade — chosen.**
Rejected alternative: a single `HakkaViewModel` object exposing every field
every component might ever need (filters, selection, diff pair, tour state,
drag position — effectively `Inspector.tsx`'s local signals promoted to one
big exported object). Rejected because it reproduces the exact problem the
rename map already flagged: a god-object, just relocated one layer down
instead of removed. It also breaks the point of building on custom elements
at all — a host embedding only `<hakka-json-tree>` would still pull in
selection-mode and command-palette-state code they never call, and would
couple to a state shape shared with five components they never mounted.

The rename map's seven-hook extraction list is not a 1:1 map onto the six
view-models, and that mismatch is itself informative, not a gap: `useFilterState`
generalizes into a **shared** `FilterViewModel` (state read by
`<hakka-request-list>`, `<hakka-waterfall>`, and `<hakka-stats>`, mutated by
`<hakka-filter-bar>`'s intents — see (b)); `useSelectionMode` generalizes into
a `SelectionViewModel` shared by `<hakka-request-list>` and
`<hakka-request-detail>` for multi-select bulk actions. `useDiffPair`,
`useCommandPaletteState`, `useTourState`, and `useDragPosition` do **not**
become P5 view-models at all — they are Inspector-shell concerns. A
standalone `<hakka-request-list>` dropped into a host's own dashboard has no
floating toggle button to drag, no command palette to open, and no
onboarding tour to run; generalizing those four would be building
infrastructure nothing in P5 calls. `useSavedFilters` is optional: it can
feed `FilterViewModel`'s saved-filter list, but nothing in the six elements
requires it to ship in v1.

### (b) Custom-element boundaries

**Shared store singleton by default; injected store as an explicit escape
hatch — chosen.** Every element attaches to the same module-level store
singleton `hakka-web`'s panels already use (`store()` from `../worker`,
exactly what `StatsTab.tsx` imports and calls today) unless a `store` (or, for
`FilterViewModel`-backed elements, `viewModel`) _property_ is set explicitly.
This is a property, not an attribute, because it's an object reference, not a
serializable scalar (see the attribute/property split below). Default-to-shared
matches `mount.tsx`'s own default (F2's embed also mounts against the same
singleton, not a caller-supplied store) and covers the primary use case at
zero configuration: a host who already runs the floating overlay or `mount()`
and wants to also drop `<hakka-request-detail>` into their own admin page gets
the same live capture stream automatically. Injection exists for a case the
same design audit names directly — the desktop companion needs `RequestList.tsx`'s windowing
algorithm with "a genuine folder-open/closed flattening adapter," i.e. its
own tree data, not Hakka's capture stream — without that case, a lone
"inject your own store" escape hatch would be unused infrastructure; with it
named, it's a real, cited requirement.

**Filter/sort/group state is shared, not per-element.** `<hakka-filter-bar>`'s
intents mutate the same `FilterViewModel` slice that `<hakka-request-list>`,
`<hakka-waterfall>`, and `<hakka-stats>` read — when both a filter bar and a
list are on one page with neither given an injected store, wiring is
automatic (both attach to the same singleton's `FilterViewModel`), the same
implicit way `Inspector.tsx`'s local signals already drive `RequestList` and
`FilterBar` as children of one component today. A lone `<hakka-request-list>`
with no filter bar present simply reads the `FilterViewModel`'s defaults
(`time`/`desc`/no group/empty text) — the same defaults `Inspector.tsx`
seeds today.

**Attribute vs. property split, per element:**

- **`<hakka-request-list>`** — attributes: `compact` (bool), `select-mode`
  (bool), `group-by` (enum string: `none`\|`host`\|`status`\|`method`\|`error`\|`trace`),
  `trace-view` (bool). Properties: `store`/`viewModel` (injected object,
  optional). Owns its own filter/sort/group orchestration internally by
  re-running `hakka-core`'s already-platform-neutral, zero-dep
  `compileQuery`/`sortRequests`/`createGroupCache` against the raw store feed
  — not new capture surface, reuse of functions RN already proves portable.
  Events: `hakka:select` (`detail: { id: string }`).
- **`<hakka-request-detail>`** — attributes: `request-id` (string; resolved
  against the shared store's snapshot). Properties: `request` (a whole
  `NetworkRequest` object, injected directly — bypasses the store lookup
  entirely for a host that already built the object itself, e.g. a desktop
  companion's response pane, which never round-trips through Hakka's capture store).
  When `request` is set, `request-id` is ignored. Events: `hakka:back`
  (replaces today's `onBack: () => void` prop — a function can't cross a
  custom-element attribute/property boundary the way a DOM CustomEvent can).
- **`<hakka-waterfall>`** — no meaningful attributes (it renders exactly one
  group, nothing to default). Properties: `group` (`RequestGroup`, required),
  `selectedId` (string \| null). Events: `hakka:select` (`detail: { id: string }`,
  replacing today's `onSelect` prop callback).
- **`<hakka-filter-bar>`** — attributes: `nl-mode` (bool), `advanced-open`
  (bool). Properties: `store`/`viewModel` (injected, optional). Events:
  `hakka:filter-change` (`detail`: the full `SavedFilter` shape) — fired in
  addition to mutating the shared `FilterViewModel` directly, so a host that
  injected its _own_ store (opted out of the shared singleton) still has a
  way to react without polling.
- **`<hakka-stats>`** — attributes: none required beyond an optional
  `runtime-filter`. Properties: `store`/`viewModel` (injected, optional;
  defaults to the shared singleton's full snapshot, exactly like
  `StatsTab.tsx` does today). Events: none — pure display.
- **`<hakka-json-tree>`** — attributes: `max-depth` (number; promotes
  `JsonNode`'s currently-hardcoded `props.depth >= 2` collapse threshold to a
  documented, configurable value). Properties: `value` (parsed
  `JsonValue`) or `text` (string, matching today's `JsonViewerProps.text`) —
  kept as a property rather than an attribute despite being a valid string,
  because attributes force a stringify-and-reparse round trip through the DOM
  that a property skips, and JSON bodies are exactly the payload size where
  that round trip is wasteful. Events: none — pure display, same as Detail.

**Event contract.** All six use the `hakka:` CustomEvent namespace prefix,
kebab-case names, `{ bubbles: true, composed: true }`. `composed: true`
matters specifically because `solid-element` renders inside a Shadow DOM: an
event dispatched from inside the shadow tree needs `composed` to cross that
boundary and reach anything listening above the custom-element host itself
(a listener attached directly to the host via `el.addEventListener` doesn't
strictly need it, but a listener attached higher — the pattern React's own
custom-element integration in (e) relies on — does).

### (c) Packaging

**`hakka-components` entry structure — per-element subpath
exports:**

```
hakka-components
  /request-list     → registers <hakka-request-list>
  /request-detail   → registers <hakka-request-detail>
  /waterfall        → registers <hakka-waterfall>
  /filter-bar       → registers <hakka-filter-bar>
  /stats            → registers <hakka-stats>
  /json-tree        → registers <hakka-json-tree>
  .  (root)         → re-exports all six, for a consumer who wants everything
```

**Relation to `hakka-web` — shared source, separate build. Chosen over a
re-export or a fork.** The six components already live at
`packages/hakka-browser/src/ui/{RequestList,Detail,TraceWaterfall,FilterBar,StatsTab,JsonViewer}.tsx`.
`packages/components` is a new sibling package in the same monorepo workspace
that points its own per-element `solid-element` registration + vite lib-mode
build at those same source files (plus the new view-model modules from (a)) —
the same "shared source, independent package, independent build" relationship
`hakka-core` already has with `react-native-hakka`/`hakka-web`/`hakka-node`
today. **Rejected — re-export `hakka-web`'s dist.** `hakka-web`'s build wraps
everything in the Inspector shell; `register.ts` registers exactly one tag,
`<hakka-inspector>`, and the six pieces are unregistered internal components
inside it today. Re-exporting that dist would drag the worker client, the tab
shell, and the theming bootstrap along for every one of the six, defeating
the entire point of per-element tree-shaking. **Rejected — fork the six
files into `packages/components` as independent copies.** This immediately
double-maintains six components that must stay visually and behaviorally
identical to their Inspector-embedded counterparts — the whole "moat" the
design audit names is that a host looking at the companion app and Hakka side by side "should [not] be
able to tell where one component system ends and the other begins," and a
source fork guarantees drift the first time a bug fix lands on only one copy.
`hakka-web`'s `Inspector.tsx` keeps owning the tab shell and imports the same
view-model modules `packages/components` does — no npm dependency between the
two packages, just shared workspace source, same relationship every existing
package already has with `hakka-core`.

**Per-component gzip budgets — new `NAMED` entries in
`scripts/web-size-gate.mjs`.** Reasoned from that file's own measured
numbers: `RulesTab`'s split Mock/Breakpoints/Throttle sub-tab chunks measured
~3.6–3.7 KB gzip each for comparable single-feature complexity, and the
entire `hakka-web` IIFE — every panel, the worker, the capture engine, the
theming registry — sits at ~117 KB gzip, so a single component with no
engine/worker/tab-shell weight around it must be a small fraction of that.
Initial budgets (pending a real measured build, same as every existing entry
in that file, which each carry a bump/cut history against real numbers):

| Element                                                                                                                                                                                               | Budget (gzip) | Why                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hakka-request-list`                                                                                                                                                                                  | 9 KB          | heaviest of the six — owns filter/sort/group orchestration per (b) plus the windowing algorithm                                                                                               |
| `hakka-request-detail`                                                                                                                                                                                | 10 KB         | `Detail.tsx` is the largest single UI source file today (1077 ln / 40.7 KB) — overview/headers/body/timing/cookies/GraphQL tabs                                                               |
| `hakka-waterfall`                                                                                                                                                                                     | 3 KB          | small, single-purpose                                                                                                                                                                         |
| `hakka-filter-bar`                                                                                                                                                                                    | 4 KB          | search box, chips, saved/recent rows                                                                                                                                                          |
| `hakka-stats`                                                                                                                                                                                         | 5 KB          | summary + charts                                                                                                                                                                              |
| `hakka-json-tree`                                                                                                                                                                                     | 3 KB          | recursive renderer, no external state                                                                                                                                                         |
| Shared runtime chunk (solid-js + solid-element + the `hakka-core` subset these six use: `compileQuery`/`sortRequests`/`createGroupCache`/types — _not_ the capture/interceptor code the worker needs) | 12 KB         | paid once; budgeted as the worst case (first element imported), not amortized across a multi-element import, since a lone `<hakka-json-tree>` import must fit under runtime + 3 KB on its own |

Worst-case total (all six + runtime, before any consumer-bundler dedup
credit): ~46 KB gzip — well under `hakka-web`'s ~117 KB IIFE, because none of
the engine/worker/tab-shell/multi-instance-theming weight that number carries
applies here. `registerThemeRoot` (see (d)) is reused as-is and adds only a
few hundred bytes, not a material line item.

### (d) Theming

Elements inherit `presets.ts`'s exact mechanism verbatim — no new mechanism.
Each of the six calls `registerThemeRoot(hostEl)` on mount, the same call
`Inspector.tsx` makes today, so `setPreset()`/`setPanelOpacity()` reach every
registered root on a page automatically: a floating `<hakka-inspector>`
overlay plus three standalone embeds (`<hakka-stats>`, `<hakka-request-list>`,
`<hakka-json-tree>`) all stay in sync, exactly matching `presets.ts`'s own
doc comment — "a page can have more than one Hakka instance live at once...
every registered root gets kept in sync."

**Theming one element differently.** `presets.ts` already documents that a
`--hakka-*` custom property set as an _inline style_ on the theme root
unconditionally wins the cascade over both the built-in default and any
active preset (highest specificity, regardless of origin). Theming a single
element distinctly from its siblings is exactly that mechanism applied to
one instance instead of every registered root: `document.querySelector
('hakka-stats').style.setProperty('--hakka-accent', '#ff3366')` wins for that
one element on that one token, while every _other_ token on that element (and
every token on every other registered root) keeps following whatever preset
is active. This is not new mechanism — it is the same per-root entry the
`activeRoots` registry already keys by distinct `HTMLElement`, applied
selectively instead of broadcast.

### (e) React wrapper

`hakka-react` ships one thin component per element
(`HakkaRequestList`, `HakkaRequestDetail`, `HakkaWaterfall`, `HakkaFilterBar`,
`HakkaStats`, `HakkaJsonTree`). Each:

- Side-effect imports the matching `hakka-components` subpath on
  module load (registers the custom element), the same pattern
  `hakka-web/register.ts` already uses for `<hakka-inspector>`.
- Renders the bare custom-element tag, relying on React 19's native
  custom-element support: React 19 forwards a prop to the DOM element as a
  _property_ when the element already exposes that name as an instance
  property (which requires the underlying `solid-element` registration to
  declare a non-empty props spec — `register.ts`'s current
  `customElement(TAG, {}, Inspector)` call passes no declared props, which is
  fine for a zero-prop shell but is _not_ the pattern the six new elements
  need; each of their registrations must declare every attribute/property
  named in (b)), and as a plain attribute otherwise.
- **Props → properties**, explicitly, not via JSX attribute spreading: object
  props (`request`, `group`, `store`/`viewModel`) are assigned onto the DOM
  element instance via a ref (`ref.current.request = props.request`), since
  JSX attribute syntax would stringify an object uselessly. Scalar props
  already declared as attributes in (b) pass through ordinary JSX attribute
  syntax, which React 19 forwards to the DOM directly.
- **Events → callbacks**: each wrapper attaches/detaches a native
  `addEventListener('hakka:select', handler)` (etc.) in a `useEffect` keyed
  on the ref and callback identity, translating the CustomEvent into the
  matching camelCase `onSelect`/`onFilterChange`/`onBack` prop. This is not
  React's synthetic event system — custom events aren't part of it — it's the
  same manual ref-plus-listener pattern any React wrapper over a third-party
  web component uses.

**What stays out: no Solid re-render bridging, of any kind.** The wrapper
never imports `solid-js`, never creates a Solid reactive root, never
re-renders the custom element's internal tree in response to React state
changes. React talks to the element exclusively through its public DOM
surface — attributes, properties, events — the same way it would integrate
any third-party web component (a `<video>` tag, a Stripe Element). That
restraint is the entire reason a thin wrapper is viable at ~1–2 KB per
element instead of a second UI implementation: the moment the wrapper starts
reasoning about Solid's reactivity from the React side, it stops being thin.

### (f) SSR/lazy behavior

**Import-safe under SSR, extending the guard `register.ts` already uses.**
`register.ts` today guards its one registration with
`typeof customElements !== 'undefined' && !customElements.get(TAG)` before
calling `customElement()` — safe no-op on a Node/Next server, safe against a
double-registration on re-import. Each of the six new subpath entries carries
the identical guard around its own `customElement()` call: importing
`hakka-components/request-list` on a server must not throw, exactly
the same contract `register.ts` already provides for `<hakka-inspector>`.

**Lazy-loading Solid internals — the per-element subpath boundary from (c)
already _is_ the lazy boundary, a stronger form of what `hakka-web` does
today.** Inside `hakka-web`, laziness is achieved with explicit `lazy()`
wrappers around sub-panels of one shell (`CommandPalette`, `RequestDiff`,
`Tour`, and every `PANEL_REGISTRY` entry are each their own lazy chunk fetched
only when their tab opens) — but the shell itself, and whichever panel loads
first, load eagerly the moment `register.ts` is imported. The six new
elements have no shell to be lazy _within_; each subpath module boundary is
already the unit a bundler code-splits on, so importing
`hakka-components/json-tree` alone never pulls in
`/request-detail`'s Solid tree — laziness is structural, at the package level,
rather than something each module has to additionally wrap in `lazy()`.

### (g) Non-goals v1

- **No Vue/Svelte wrappers.** Both frameworks already interoperate with
  arbitrary custom elements — property binding and native event listening
  work out of the box — the way React, until version 19, did not. A wrapper
  package is only justified where the host framework's own custom-element
  interop has a real gap; React's is the one named in (e) (events aren't
  auto-mapped, and object props need the same ref-based assignment). Vue and
  Svelte don't have that gap, so a dedicated wrapper for either would be
  unused infrastructure, not a completed set.
- **No shadow-DOM-less light mode.** All six render into a Shadow DOM via
  `solid-element`, matching the CSS-isolation guarantee `mount.tsx` and
  `register.ts` already provide. A light-DOM variant (for a host that wants
  its own global stylesheet — Tailwind utilities, say — to reach inside the
  component) is real, known demand in the wider web-component ecosystem, but
  it means a second render mode per element to build and keep in sync, and it
  directly undermines the isolation `presets.ts`'s whole token mechanism
  exists to guarantee. Deferred, not ruled out.
- **No NoodleUI copy-paste distribution.** Already addressed in Context:
  NoodleUI's registry model assumes React source to copy; Hakka's source is
  Solid. npm, via `hakka-react`'s thin wrapper, is the only
  distribution path for v1.

## Build order

- **View-models (extract from `Inspector.tsx` per rename-map item 3,
  generalize to the (a) contract) — L.** This _is_ the rename map's own #3
  entry — a 1500+-line file, seven hooks to extract — plus the additional
  work of turning each Solid-signal-shaped hook into the platform-neutral
  `getSnapshot`/`subscribe`/`intents` contract from (a). The extraction alone
  is already flagged L-scale in the rename map; generalizing it on top
  doesn't shrink that, and everything below depends on it existing first.
- **Custom elements (six `solid-element` registrations, props specs,
  CustomEvent dispatch, `registerThemeRoot` wiring) — M.** Mechanical once
  the view-models exist — each element wraps an existing `.tsx` component
  plus its view-model in `customElement()`. The bespoke parts are
  `<hakka-request-list>`'s `group-by`/`compact` orchestration,
  `<hakka-request-detail>`'s `request-id` resolution, and
  `<hakka-filter-bar>`'s `viewModel` injection path; `<hakka-waterfall>`,
  `<hakka-json-tree>`, and `<hakka-stats>` are each closer to S on their own.
- **`hakka-react` wrapper package — S.** Once the custom elements
  and their props specs are settled, each of the six wrappers is a small,
  repetitive props/events adapter — the design cost in (e) is paid here in
  the ADR, not deferred into implementation.
- **Packaging + size gate (per-component subpath builds,
  `scripts/web-size-gate.mjs` entries per (c)) — S.** Vite lib-mode config
  for six entries is largely copy-and-configure from `hakka-web`'s existing
  `vite.config.ts`.
- **Docs + hero embed (per-element usage docs, a live demo pairing at least
  `<hakka-request-list>` with `<hakka-request-detail>`) — M.** Six
  components' worth of usage documentation, plus a genuinely convincing
  standalone demo, is real writing and example-app work, not a rounding
  error.

**Overall: L**, dominated by the view-model extraction. Everything after it
is bounded once that layer exists in its generalized form; the honest risk is
that step is doing double duty — paying off `Inspector.tsx`'s existing tech
debt _and_ building new platform-neutral infrastructure in the same pass — so
if it slips, every later step slips with it.

## Verification plan

- **Unit:** each view-model's `subscribe`/`getSnapshot`/`intents` contract
  tested in isolation, no Solid, no DOM — e.g. `FilterViewModel.intents
.setFilter()` then `getSnapshot()` reflects it; `subscribe()`'s listener
  fires exactly once per intent call, not once per internal signal write,
  mirroring the upsert-batching discipline `Inspector.tsx` already applies.
- **Integration:** a `packages/components` test per element (`happy-dom`,
  `@solidjs/testing-library` — the same stack `hakka-web`'s own tests already
  use) — `document.createElement('hakka-request-list')`, set properties,
  assert rendered rows; assert each documented CustomEvent fires with the
  documented `detail` shape.
- **Cross-framework smoke:** a small React 19 fixture rendering all six
  `hakka-react` wrappers side by side — assert props reach the
  underlying element's properties, and a synthetic interaction fires the
  wrapper's `onXxx` callback. This is the sturdiest check on (e)'s "no Solid
  re-render bridging" claim: a bridging bug shows up here as either a missed
  update or a double-render.
- **Theming:** two simultaneous instances of the same element (or one
  instance alongside a floating `<hakka-inspector>`) on one fixture page —
  assert `setPreset()` reaches both via `registerThemeRoot`, then assert a
  single-element inline-style override on _one_ instance survives a
  subsequent `setPreset()` call to the others, per (d).
- **Size:** extend `scripts/web-size-gate.mjs` (or a `components`-specific
  sibling script) with the six `NAMED` budgets from (c); CI fails the build
  if any subpath's gzip exceeds budget, the same discipline already enforced
  for `hakka-web`'s own bundles.
- **SSR:** import each `hakka-components` subpath under Node (no
  DOM globals) and assert it doesn't throw — mirrors `register.ts`'s
  existing `typeof customElements !== 'undefined'` guard, extended to all six
  new entry points, per (f).
