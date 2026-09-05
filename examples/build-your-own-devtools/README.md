# Build your own devtools

A working example of [`hakka-browser/elements`](../../docs/src/content/docs/guides/build-your-own-devtools.mdx)
(ADR 0003): the six standalone custom elements the floating `<hakka-inspector>` overlay is built
from, composed here into a devtools panel that looks nothing like that overlay. Full-page grid
layout, no bottom sheet, no tab shell, no command palette, no Hakka branding chrome. That's the
point: these six pieces are raw material for your own UI, not a fixed shell.

Two entry points, same layout, same demo API:

- `index.html`, vanilla, direct from `hakka-browser/elements`
- `react.html`, the same panel built from `hakka-browser/react`'s wrapper components

Real traffic, not seeded fixtures. A tiny local API (`server/demoApi.ts`, Vite dev-server
middleware) gives the panel a fast happy path, a request that's always slow, one that always 500s,
a POST that echoes its body, and a 404 for an unknown user id. Click a button, watch the row land.

## Run it

```sh
just build-browser   # or: bun run --cwd ../../packages build   (builds hakka-core + hakka-browser dist)
npm install           # see "Why npm" below
npm run dev
```

Open `http://localhost:5195/` for the vanilla panel, `http://localhost:5195/react.html` for the
React one. There's also a `just demo-devtools-panel` recipe from the repo root that does the build,
install, and dev steps above in one shot.

### Why npm, and why outside the workspace

`hakka-browser` isn't published to npm yet, so this example depends on it via `file:../../packages/hakka-browser` and
resolves `hakka-core` the same way. It lives outside the root workspace (`packages/*` only matches
one level deep) so it resolves `hakka-browser`/`hakka-core` exactly the way an outside consumer
would, not through hoisted monorepo `node_modules`. Install with npm, not bun. bun lays `file:`
deps out as per-file symlinks that Vite's dependency pre-bundling doesn't always follow the same
way npm's real copy does. See `examples/next-fullstack/package.json`'s own note for the fuller
version of this pattern.

## The one non-obvious thing this example is built around

`hakka-browser` (the root package, `start()`, the floating overlay) and `hakka-browser/elements/*`
are built as **separate bundles**: three independent `vite build --mode X` passes in
`packages/hakka-browser/vite.config.ts`. Each bundle gets its own copy of every module's top-level
state, including the capture store singleton. Call `start()` from the root entry and it populates
the root bundle's store. `hakka-browser/elements`' own internal `sharedStore()` reads a different
one and never sees it. Two bundles from one npm package still don't share module state, the same
way two separate packages wouldn't.

So this example doesn't import `hakka-browser` (root) at all. `src/demoStore.ts` wires
`hakka-core`'s own `enableFetchInterceptor`/`enableXHRInterceptor` directly into a small
hand-rolled store (duck-typed against what `<hakka-request-list>` and `<hakka-stats>`'s
view-models actually call, proven by `packages/hakka-browser/e2e/fixtures/components-standalone.html`'s
identical `makeStore()`), and that one store object is injected into every element via the
documented `store` property (ADR 0003 (b), the "injected store as an explicit escape hatch"
decision). One store, constructed once, shared by reference. No overlay bundle needed at all, just
the capture engine (`hakka-core`) and the six UI elements (`hakka-browser/elements`).

## The six elements, what this panel does with them

| Element                  | Where it lives             | Props/attributes used here                                                 | Own gzip budget\* |
| ------------------------ | -------------------------- | -------------------------------------------------------------------------- | ----------------- |
| `<hakka-request-list>`   | left rail                  | `compact`, `store` (injected)                                              | 9 KB              |
| `<hakka-request-detail>` | main panel, Detail tab     | `request` (full object, set on select, see below)                          | 10 KB             |
| `<hakka-waterfall>`      | main panel, Waterfall tab  | `group` (recomputed every second from `store.getSnapshot()`), `selectedId` | 3 KB              |
| `<hakka-filter-bar>`     | top strip                  | `store` (injected, ranks captured hosts for search suggestions)            | 5 KB              |
| `<hakka-stats>`          | right rail                 | `store` (injected)                                                         | 5 KB              |
| `<hakka-json-tree>`      | right rail, "Raw response" | `text` (the selected request's real `responseBody`), `max-depth`           | 3 KB              |

\* Own weight, excluding the shared runtime chunk (solid-js plus the `hakka-core` query subset,
about 85 KB, paid once regardless of how many elements you import). See
`packages/hakka-browser/scripts/web-size-gate.mjs` for the full accounting and how it's measured.

`<hakka-request-detail>` is the one element with no `store` property to inject at all. ADR 0003
(b): it only resolves a `request-id` attribute against the elements bundle's own shared singleton,
which this example deliberately doesn't populate, or takes a full `request` object directly.
Selecting a row hands it that full object. `panel.ts`/`ReactPanel.tsx` look the id up in the same
store that's already backing the list, no separate fetch.

`<hakka-waterfall>` is the one pure props-in renderer with no store subscription of its own,
so something has to keep it fed. This panel polls `store.getSnapshot()` every second and regroups
with `hakka-core`'s own `groupRequests(logs, 'host')`, the same function the
[docs guide](../../docs/src/content/docs/guides/build-your-own-devtools.mdx)'s own
E2E-report recipe uses. Every request in this demo shares one host, so that's a single group: the
full session laid out on one shared timeline.

## Theming

`hakka-browser/elements` ships no `setPreset()` of its own by design (there's no settings UI in
these six elements). `src/theme.ts` reproduces two of `ui/presets.ts`'s curated bundles (`amber`,
`paper`), token values copied verbatim, applied as direct `--hakka-*` inline overrides on every
element host at once, the documented mechanism (ADR 0003 (d)) for theming elements outside the
Inspector shell. The theme picker in the header calls it.

## Injection timing, if you're wiring your own

`<hakka-request-list>` and `<hakka-stats>` build their view-model from `props.store` exactly once,
the first time it's read: an `ownVm ??= createXViewModel({ store: props.store ?? ... })` memo in
both element source files. Set `.store` after the element has already connected to the DOM and the
assignment is silently too late; the element keeps reading the default shared singleton forever.
`panel.ts` therefore builds both with `document.createElement()`, sets `.store` on the detached
node, then inserts it, mirroring the e2e fixture's exact ordering. `<hakka-filter-bar>`'s `store`
is read reactively (a `createEffect`, not a one-time memo), so it stays a plain static tag with the
property set after the fact.

React doesn't need any of this. `createElementWrapper.tsx` calls the element's `register()`
synchronously during render, before `React.createElement(tag, props)`, and React's own commit
pipeline sets a host component's initial properties on the freshly created DOM node before
inserting it into the document. Passing `store={store}` as an ordinary JSX prop already lands
before the element connects. `ReactPanel.tsx` just writes `<RequestList store={store} />`.

## What this deliberately doesn't cover

- **No trace correlation.** `<hakka-waterfall>` groups by host, not by `trace`, because trace
  propagation needs `hakka-node` cooperating on a real server, out of scope for a
  `hakka-browser`-only example. `groupRequests` takes either basis; swap `'host'` for `'trace'` if
  your own app runs `hakka-node` behind it.
- **No WebSocket demo.** The demo API is plain HTTP.
- **`matchIds()` (the `body:`/`all:`-scoped search path) is substring-mode only.** The real
  hakka-browser store also supports wildcard/regex tokens; `demoStore.ts` covers the common case
  (plain text in the search box) and says so in its own comment rather than silently matching
  wrong on the rest.

## See also

- [Guide: Build your own devtools](../../docs/src/content/docs/guides/build-your-own-devtools.mdx)
- [ADR 0003: Embeddable components](../../docs/src/content/docs/contributing/adr/0003-embeddable-components.md)
- `packages/hakka-browser/e2e/fixtures/components-standalone.html`, the Playwright-driven proof
  this same injected-store pattern works, with a synthetic store instead of real interceptors.
