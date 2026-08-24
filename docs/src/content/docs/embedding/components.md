---
title: Components
description: Reference for hakka-browser/elements — the six standalone Hakka network-inspector pieces as framework-agnostic custom elements.
---

`hakka-browser`'s `/elements/*` subpaths ship six pieces of the overlay — a request list, a detail
pane, a waterfall, a filter bar, a stats panel, a JSON tree — as standalone custom elements.
Each one compiles from the exact same SolidJS source `hakka-browser`'s `<hakka-inspector>` uses
(ADR 0003's "shared source, separate build"), so a standalone `<hakka-request-list>` renders
pixel-identical to the Network tab inside the full overlay.

Reach for this package when you want **one piece** of Hakka's UI inside a layout you already
own — an internal admin page, a CI/E2E report, a dashboard widget — instead of the full
floating overlay `hakka-browser`'s root entry ships (tab shell, command palette, toggle button,
worker bootstrap). If you want that full overlay, see [Web overview](/web/overview/) instead. If
you're in a React app, [`hakka-browser/react`](/embedding/react/) wraps these same elements with typed
props. For a walkthrough of composing these elements together (list + detail pairing, a
waterfall for one failed trace, wiring a filter bar), see
[Build your own devtools](/guides/build-your-own-devtools/) — this page is the element-by-element
reference; that guide is the recipe collection.

## Install

```sh
bun add hakka-browser
```

## Registration

Registration is **explicit and on-demand** — importing a subpath never touches
`customElements` on its own, a deliberately stronger SSR guarantee than a guarded side effect
on import. Call the subpath's `register()` (or `registerAll()` from the root import) once,
then use the tag like any other HTML element:

```ts
import { register } from 'hakka-browser/elements/request-list'

register()
document.body.innerHTML = '<hakka-request-list group-by="host"></hakka-request-list>'
```

Every subpath is its own bundler entry point and its own `register()`/`TAG` export — importing
`hakka-browser/elements/json-tree` alone never pulls in another element's Solid tree:

| Subpath                                 | Tag                    |
| --------------------------------------- | ---------------------- |
| `hakka-browser/elements/request-list`   | `hakka-request-list`   |
| `hakka-browser/elements/request-detail` | `hakka-request-detail` |
| `hakka-browser/elements/waterfall`      | `hakka-waterfall`      |
| `hakka-browser/elements/filter-bar`     | `hakka-filter-bar`     |
| `hakka-browser/elements/stats`          | `hakka-stats`          |
| `hakka-browser/elements/json-tree`      | `hakka-json-tree`      |

The root `hakka-browser/elements` entry re-exports all six `register*()` functions, all six `TAG`
constants, and `registerAll()` (calls all six). Both entry points are idempotent — calling
`register()`/`registerAll()` more than once, or on an environment with no `customElements`
global (SSR), is a safe no-op rather than a throw.

Boolean attributes need an explicit value string — `compact="true"`, not a bare `compact` —
this is the underlying `@solidjs/element`/`component-register` dependency's own attribute-parsing
behavior, not something this package layers on top.

## Element reference

All six render into a Shadow DOM and default to a shared, module-scoped capture
store/filter/selection singleton — two elements from these subpaths on one page (e.g. a list and
a filter bar) wire together automatically, no store to construct.

| Element                  | Tag                    | Wraps                | Attributes                                                                                                                                                                                                                                           | Properties                                                                                                                                                                                   | Events                                               |
| ------------------------ | ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `<hakka-request-list>`   | `hakka-request-list`   | `RequestList.tsx`    | `compact` (bool, default `false`), `select-mode` (bool, default `false`), `group-by` (enum `none` / `host` / `status` / `method` / `error` / `trace`, default `none`), `trace-view` (bool, default `false`), `verbose-spans` (bool, default `false`) | `store` (`StoreClient`, nullable), `viewModel` (`RequestListViewModel`, nullable), `spansByTrace` (`ReadonlyMap<string, FrameworkSpan[]>`, nullable — overrides the view model's live spans) | `hakka:select` — `detail: { id: string }`            |
| `<hakka-request-detail>` | `hakka-request-detail` | `Detail.tsx`         | `request-id` (string, default `''`)                                                                                                                                                                                                                  | `request` (`NetworkRequest`, nullable)                                                                                                                                                       | `hakka:back` — `detail: {}`                          |
| `<hakka-waterfall>`      | `hakka-waterfall`      | `TraceWaterfall.tsx` | `verbose` (bool, default `false` — show non-primary framework spans)                                                                                                                                                                                 | `group` (`RequestGroup`, required), `selectedId` (string, nullable), `spans` (`FrameworkSpan[]`, default `[]`)                                                                               | `hakka:select` — `detail: { id: string }`            |
| `<hakka-filter-bar>`     | `hakka-filter-bar`     | `FilterBar.tsx`      | `nl-mode` (bool, default `false`), `advanced-open` (bool, default `false`)                                                                                                                                                                           | `store` (`MinimalStore`, nullable, suggestions only), `viewModel` (`FilterViewModel`, nullable)                                                                                              | `hakka:filter-change` — `detail`: full `SavedFilter` |
| `<hakka-stats>`          | `hakka-stats`          | `StatsTab.tsx`       | none                                                                                                                                                                                                                                                 | `store` (`StoreClient`, nullable), `viewModel` (`StatsViewModel`, nullable)                                                                                                                  | none — pure display                                  |
| `<hakka-json-tree>`      | `hakka-json-tree`      | `JsonViewer.tsx`     | `max-depth` (number, default `2`) — collapse threshold; nodes at `depth >= max-depth` start collapsed                                                                                                                                                | `value` (`unknown`, wins over `text` if both set), `text` (string, nullable)                                                                                                                 | none — pure display                                  |

Object properties (`store`, `viewModel`, `request`, `group`) must be set as real DOM
properties, not attributes — a plain HTML attribute would stringify an object to
`"[object Object]"`. Set them with `el.property = value` in vanilla JS, or use
[`hakka-browser/react`](/embedding/react/) if you want them to work as JSX props.

### `<hakka-request-list>` and `<hakka-filter-bar>`: seed-once, not continuous sync

`select-mode` and `group-by` back the shared `SelectionViewModel`/`FilterViewModel`
singletons — same for `<hakka-filter-bar>`'s `nl-mode`/`advanced-open`. All four are read
**once, at connect**, not continuously re-applied. A continuous sync would let whichever
element instance mounts last stomp every earlier instance's live shared state back to its own
attribute value. Seeding once gives the common single-instance case "start already in this
state" behavior without that failure mode when more than one instance shares the page.
`compact` and `trace-view` have no shared-state backing and stay fully reactive on every
re-render.

### `<hakka-request-detail>` resolution order

An injected `request` property always wins outright. Otherwise `request-id` resolves against
the **shared store singleton's** snapshot — there is no injectable `store` property on this
element, unlike request-list/filter-bar/stats. If you inject a custom `store` into a paired
`<hakka-request-list>`, set `.request` on the detail element directly with the matched
`NetworkRequest` instead of `request-id`.

### `<hakka-json-tree>`'s `max-depth`

`max-depth` is a real, working attribute — it changes `JsonViewer`'s per-node collapse
threshold (`depth >= max-depth` starts collapsed), verified against
`packages/hakka-browser/src/ui/elements/__tests__/json-tree.test.tsx`'s own coverage (`max-depth="1"` collapses a
depth-1 node; `max-depth="9"` expands everything). It is not a no-op.

## SSR safety

Two mechanisms make importing and calling `register()` safe under Node/SSR, where no DOM
exists:

- **`register()` guards on `customElements`.** Every `register()` checks
  `typeof customElements !== 'undefined'` before calling `customElement()`, so calling it on
  the server is a no-op, not a throw.
- **The actual Solid component behind each element is lazy-loaded.** `@solidjs/vite-plugin`'s
  compiled JSX runs module-scope `_$template()` calls that touch `document` the instant the
  module is evaluated — a plain top-level import of e.g. `RequestList.tsx` would crash under
  bare Node. Each element instead wraps its component in Solid's `lazy()` + `<Suspense>`,
  which only calls `import()` the first time a real, connected element instance actually
  renders — something that never happens under Node, since nothing there ever connects. This
  also keeps `register()` itself synchronous, so a property set on the element right after
  calling it (`el.store = myStore`) is wired up the same tick, with no async-upgrade race to
  lose it across.

Each element also adopts its stylesheet via `ShadowRoot.adoptedStyleSheets` rather than
appending a `<style>` tag as a shadow-tree child. `@solidjs/element`'s mount (`withSolid()`) clears
`renderRoot.textContent` as part of the same initial render pass that would otherwise insert
that tag, wiping it out before the component's own JSX renders — `adoptedStyleSheets` entries
aren't DOM children, so they survive that clear. Environments without Constructable
Stylesheets fall back to an inline `<style>` tag automatically.

## Theming

Same mechanism as `hakka-browser`: every `--hakka-*` CSS custom property set inline on the element
wins over the built-in default.

```js
document.querySelector('hakka-json-tree').style.setProperty('--hakka-accent', '#ff3366')
```

The full themable set — surfaces, text, JSON syntax colors, radii, spacing, type scale, control
heights — is documented in `presets.ts`'s own header comment.

`<hakka-request-list>` additionally caps its own height with `--hakka-list-max-height`
(default `480px`) instead of growing to fit however many rows are captured:

```css
hakka-request-list {
  --hakka-list-max-height: 640px;
}
```

Every element registers itself as a theme root on mount (unregisters on unmount), reusing
`hakka-browser`'s `presets.ts` mechanism verbatim. `presets.ts` ships six curated bundles (`navy`,
`light`, `high-contrast`, `amber`, `matrix`, `paper`) over the surface/text/JSON-syntax token
groups — status/method/timing colors stay fixed regardless of which preset is active, by design
(picked mid-luminance to read the same meaning on any ground). Multiple elements on one page —
including a floating `<hakka-inspector>` from `hakka-browser` — stay in sync with `hakka-browser`'s
exported `setPreset()`/`setPanelOpacity()` calls:

```ts
import { setPreset } from 'hakka-browser'
setPreset('paper')
```

The `/elements/*` subpaths don't export a `setPreset()` of their own — there's no settings UI in
these six elements, that lives in the Inspector shell, out of this entry point's scope — so a
preset choice always has to come from `hakka-browser`'s root entry being used on the same page,
or from reproducing the preset's token values yourself via the per-element override above.

That call persists the choice to `localStorage` (`hakka:ui`) and re-themes every
currently-mounted `hakka-browser` element immediately. An `/elements/*` element that mounts (or
remounts) afterward reads the same persisted key and picks up the preset automatically on
connect — but an _already-mounted_ `/elements/*` element won't update live, since the root entry
and the `/elements/*` subpaths are separate bundler entry points and don't share a runtime module
instance: `setPreset()`'s own `activeRoots` registry (`presets.ts`) is a separate copy per entry
point, the same reason the capture-state paragraph below applies.

This does **not** currently extend across a separately used `hakka-browser` root entry for
capture state either: the two are separate bundler entry points of the same npm package, so each
gets its own copy of the underlying store singleton at runtime, even though both compile from the
same monorepo source. Two elements from the `/elements/*` subpaths on one page share capture
state automatically (a bundler resolves both subpaths to one physical module); a
`<hakka-inspector>` from the separately-used root entry does not — inject your own store into
both via the `store`/`viewModel` property to share live capture across the two entry points.

## Known limitations

- **`dist/types` includes declaration files unrelated to these six elements** — the whole
  `hakka-browser` `ui`/`worker` source tree, pulled in transitively by TypeScript's declaration
  emission. Harmless (`.d.ts` files carry zero runtime/bundle-size cost); a real fix is a known
  fast-follow.
- **The shared runtime chunk is larger than ADR 0003's original 12 KB estimate** — measured
  ~83 KB gzip (budgeted at 85 KB in `scripts/web-size-gate.mjs`). It bundles the Solid 2.0
  runtime (solid-js + `@solidjs/web` + `@solidjs/signals` + `@solidjs/element`, per ADR 0007)
  - the `hakka-core` query subset, `hakka-browser`'s full CSS (reused verbatim for
    pixel-identical rendering), and the store client, which itself embeds the capture-engine
    code twice (an in-process fallback path, plus a second copy for the Worker build).

## See also

- [Build your own devtools](/guides/build-your-own-devtools/) — composition recipes: pairing a
  list with a detail view, a waterfall for a CI report, a stats widget on a dashboard.
- [React](/embedding/react/) — typed React wrappers over these same six elements.
- [Web overview](/web/overview/) — the full floating overlay these elements are built from.
- [Core overview](/core/overview/) — `hakka-core`, the platform-neutral capture engine
  underneath every element.
