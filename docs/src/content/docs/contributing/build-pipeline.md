---
title: Build Pipeline
description: How hakka-browser's Vite and tsdown build configs are structured, why each quirk-workaround exists, and what has to keep being true for the merge that consolidated five config files into two.
---

`packages/hakka-browser` ships five outputs — the overlay (ESM + IIFE), the
worker capture shim, six standalone custom elements, the build-tool plugin
entry points, and the React wrapper — from **two** config files:
`vite.config.ts` (mode-switched) and `tsdown.config.ts` (an array config).
Before the consolidation described here, those were five separate files
(`vite.config.ts`, `vite.worker.config.ts`, `vite.elements.config.ts`,
`tsdown.plugin.config.ts`, `tsdown.react.config.ts`). This page is where the
long-form rationale that used to live as comments in those files now lives —
each config file itself keeps only a 1–3 line pointer back here.

## Build ordering

`package.json`'s `build` script is:

```
vite build && vite build --mode worker && vite build --mode elements && tsc -p tsconfig.build.json && tsdown
```

The three `vite build` invocations are order-dependent, not just concurrent
alternatives run for convenience:

1. Bare `vite build` (mode defaults to `production`) builds the overlay and
   **wipes `dist/`** (`emptyOutDir: true`).
2. `vite build --mode worker` must run _after_ that wipe, and sets
   `emptyOutDir: false` so it only _appends_ `dist/worker.js` without
   clearing the overlay bundles the first pass just wrote.
3. `vite build --mode elements` wipes only its own `dist/elements`
   subdirectory (`outDir: 'dist/elements'`, `emptyOutDir: true` scoped to that
   dir), so it doesn't touch `dist/hakka-browser*.js` or `dist/worker.js`.

Collapsing the three configs into one file does not remove the need for three
separate CLI invocations in this order — a single `vite build` command can
only run one `mode` per process.

## Mode strings and env safety

Routing three builds through one config via `--mode worker` / `--mode
elements` raises an obvious question: does a non-`'production'` mode string
leak into any code path and change behavior? This was investigated end to end
before the merge:

- **No first-party source branches on it.** Nothing in `src/` reads
  `import.meta.env` or `process.env` at all.
- **`process.env.NODE_ENV` is mode-independent for `vite build`.** Vite's
  `resolveConfig` always resolves `NODE_ENV` to `'production'` for the build
  command regardless of `--mode`, and mutates the real Node process's
  `process.env.NODE_ENV` as a side effect before any plugin logic runs. Every
  dependency that gates dev-only code on `process.env.NODE_ENV === 'production'`
  (the common pattern) behaves identically across all three modes.
- **`import.meta.env.MODE` does differ** (`'worker'` / `'elements'` instead of
  `'production'`) — but nothing in this package's dependency tree reads
  `import.meta.env.MODE` literally (checked across all of `node_modules`).
  This is the one part of the hazard that's real in principle but unexercised
  today. `vite.config.ts` closes it anyway with
  `define: { 'import.meta.env.MODE': JSON.stringify('production') }` on the
  `worker` and `elements` branches — cheap, and it means a future dependency
  bump can't silently change behavior here without also changing the literal
  string this config emits.
- **One confirmed-but-dormant exception**: `@solidjs/vite-plugin`'s bundled
  `solid:server-functions/setup` sub-plugin has `env = config.mode !==
'production' ? 'development' : 'production'`. `solid()` loads in the
  `elements` mode (not `worker`), so post-merge this branch evaluates to
  `'development'` there for the first time. It stays dormant because this
  package has no `use server` directive, no env schema, and no `.env*` files
  anywhere under `packages/hakka-browser` — the code paths that `env` value
  gates are never reached. The part of the plugin that actually affects
  _emitted bundle code_ — dev-vs-prod JSX/dom-expressions codegen — is keyed
  on `command === 'serve'`, not `mode`, so compiled Solid output is identical
  across all three build modes regardless of this branch. This can't be
  neutralized via `define` (it's Node-side plugin logic, not client code), so
  it's neutralized by construction (no reachable server-functions code) and
  re-verified empirically on every build by the dist-parity check below.
- **`.env.[mode]` file loading is a footgun for later, not today.** Vite's
  `loadEnv` and the solid plugin's own `.env.${mode}` lookup will look for
  `.env.worker` / `.env.elements` instead of `.env.production` once `--mode`
  is explicit. Moot right now (no `.env*` files exist), but a future
  `.env.production`-scoped value would silently not apply to the worker or
  elements builds. If you ever add one, check this section first.

**How this stays true going forward:** the acceptance check for any change to
this build is a dist-parity diff (sorted file list + per-file gzip size,
old build vs new) — see the bottom of this page. If the dormant solid-plugin
branch, or anything else mode-dependent, ever starts affecting emitted code,
that diff catches it immediately, without anyone having to re-audit
`node_modules` by hand.

## tsdown array concurrency

`tsdown.config.ts` exports an array of two `UserConfig` objects (`plugin` and
`react`). tsdown's `buildWithConfigs` runs every array entry **concurrently**
in one Node process (`Promise.all(configs.map(buildSingle))`) — before the
merge, `tsdown --config tsdown.plugin.config.ts && tsdown --config
tsdown.react.config.ts` ran them **sequentially** as two separate processes.
This is a real behavioral change, not just a file reorganization.

It's safe here because the two entries share nothing that concurrent
execution could corrupt:

- Disjoint `outDir`s (`dist/plugin` vs `dist/react`) — no output collision.
- Disjoint `entry` sets — no shared intermediate state.
- Both already `clean: false` — the shared, memoized `cleanOutDir(configs)`
  call is a no-op for both either way, so there's no output-directory wipe
  race.

If a future third entry needs `clean: true`, or the two entries start sharing
an `outDir`, re-check this section — concurrent execution stops being free at
that point.

## Sourcemaps off

Every build mode in `vite.config.ts`, and both entries in `tsdown.config.ts`,
set `sourcemap: false`. This is deliberate, not an oversight: `hakka-browser`
and `hakka-rozenite` together were 6.2 MB of the repo's 7 MB of published
`.map` files across all published tarballs (see `CHANGELOG.md`). Generation
is off at the source (every build config) rather than filtering `.map` out of
the package's `files` list, so no dangling `sourceMappingURL` comment gets
published that would 404 in a consumer's devtools. `hakka-core`, `hakka-node`,
and `hakka` (CLI) deliberately keep their sourcemaps — they're small, and the
engine is where user-facing bugs actually need to be traced.

## Worker doesn't inherit minify

Both the overlay build (default mode) and the elements build embed an inline
store Worker (`?worker&inline` on `worker/storeClient.ts`, used by
`worker/storeClient.ts`'s in-process fallback and by the Worker itself). Vite
builds that inline worker as a **separate sub-bundle**, and that sub-bundle
does **not** automatically inherit the outer `build.minify: 'terser'` setting
— Vite only auto-minifies worker output when `build.minify` is literally
`'oxc'` or `false`; a `'terser'` outer setting falls through to _no_
minification at all for the worker sub-bundle. This was confirmed by decoding
the shipped blob, which came back with real newlines and tabs before the fix.

The fix is the `worker: { rollupOptions: { output: { minify: true } } }` block
present on every mode that bundles the worker (default + `elements`; `worker`
mode doesn't need it — it _is_ the worker build, already minified by its own
top-level `minify: 'terser'`). The worker runs in its own execution context
(loaded from a Blob/`data:` URI), so full minification there can never
collide with the main bundle's terser-mangled names — it's free size, not a
tradeoff. Without this, `scripts/web-size-gate.mjs`'s IIFE and shared-chunk
budgets silently balloon on an otherwise-unrelated change, because the
worker's entire compiled source ships twice: once normally, and again as an
unminified string constant.

## Elements build

`hakka-browser/elements/*` is ADR 0003 (c): "shared source, separate build."
Six standalone custom elements, each its own Vite lib-mode entry, built from
the exact same `src/ui/elements/*.tsx` source the Inspector shell itself
imports for its `Detail` / `RequestList` / `TraceWaterfall` / `FilterBar` /
`StatsTab` / `JsonViewer` panels — not a fork, and not a re-export of the
Inspector-shell dist (rejected by ADR 0003 (c) precisely because that would
drag the worker client, tab shell, and theming bootstrap into every element
and destroy per-element tree-shaking). `formats: ['es']` only (no iife/cjs)
lets Rollup code-split shared dependencies into their own chunk(s); importing
one subpath (e.g. `hakka-browser/elements/request-list`) fetches only that
entry's small chunk plus the shared chunk(s) it needs — never another
element's Solid tree.

### Shared chunk naming

`scripts/web-size-gate.mjs`'s per-element budget walk needs to separate each
element's "own weight" from the runtime it shares with every other element
(the Solid 2.0 runtime — solid-js, `@solidjs/web`, `@solidjs/signals`,
`@solidjs/element` — plus the `hakka-core` query subset, `styles.ts`, the
store client). Rollup's default auto-naming heuristic for a chunk shared by
every entry is an implementation detail, not a stable contract — relying on
it means the gate script could silently start attributing shared weight to
whichever element happens to import it first. `chunkFileNames` in
`vite.config.ts`'s `elements` branch pins this architecturally instead: any
chunk containing `elements/shared.ts` or `elements/tags.ts` (always co-loaded
by every entry), or `hakka-core`'s own bundled module (always needed,
transitively, by every entry's `viewModels`), is forced onto a stable
`shared-[name]-[hash].js` name. Everything else — each entry's own
`lazy()`-loaded component chunk, and small multi-entry-but-not-all-six
utilities like the icon set, which the gate deliberately keeps out of the
shared bucket — keeps Rollup's normal auto-picked name.

Two more markers exist for the same reason: the solid-js/
`@solidjs/*` runtime and `src/worker/`'s store client are ALSO always
co-loaded by every entry, but Solid 2.0 RC's package split (`solid-js` into
`solid-js` + `@solidjs/signals` + `@solidjs/web` + `@solidjs/element`)
reshaped Rollup's default chunk graph enough that they landed in their own
chunks, unmatched by any of the three markers above — six-fold-duplicated
into every per-element budget row instead of counted once here. These two
are matched on Rollup's own `chunkInfo.name` (`'web'` / `'worker'`), not a
`moduleIds` path substring: `@solidjs/signals` ships two files
(`optimistic.js`, `verdict.js`) that only `Detail.tsx`'s async body memo
uses, which Rollup correctly folds into Detail's own per-element chunk — a
path substring on `@solidjs/` would match those two files and wrongly pin
Detail's whole ~11 KB chunk into the shared bucket too. Re-verify after any
Solid dependency bump that `dist/elements/shared-web-*.js` and
`dist/elements/shared-worker-*.js` still exist (rather than Rollup silently
renaming them again, the same failure mode this section already documents
once above).

## CSS minifier scope

`vite.config.ts` includes a small, dependency-free CSS minifier
(`minifyCss` / `minifyInlineStyles`) instead of pulling in `lightningcss` or
`esbuild` as an explicit devDependency. Neither is hoisted into this
package's resolvable `node_modules` today (`vite` is the rolldown-powered
build, not the esbuild/Rollup line, and doesn't bring either in as a
resolvable peer here) — adding one just to strip whitespace from one
~50 KB template-literal string would be exactly the "new heavyweight dep" a
CSS-minify step is supposed to avoid.

It's deliberately narrow: it strips comments and collapses/removes whitespace
only where doing so can never change meaning. Critically, it never removes
the space _before_ a `:` — that space can be a descendant combinator ahead of
a pseudo-class or pseudo-element (`.foo :hover` selects a hovered _descendant_
of `.foo`; `.foo:hover` selects `.foo` itself while hovered — collapsing the
two would silently change which elements a rule matches). Every other
adjacency to `{ } ; , :` is unambiguous to collapse.

It runs only at build time (`apply: 'build'`) against the `STYLES` template
literal in `ui/styles.ts` — dev keeps it verbatim and readable in devtools
while iterating, and Vitest never loads this plugin at all. Before the merge
this function was duplicated verbatim between `vite.config.ts` and
`vite.elements.config.ts`; the merge collapsed it to one definition shared by
both the default and `elements` branches.

## paths circular-resolution trick

`src/react/*` self-imports its own `hakka-browser/elements/*` subpaths — the
same specifier the built `dist/react` output re-exports through at runtime.
Two different tsconfigs resolve that specifier two different ways, on
purpose, for two different consumers:

- **`tsconfig.json`** (used by `tsc --noEmit` / `typecheck`, and by
  `tsc -p tsconfig.build.json` for `.d.ts` emission) sets
  `paths: { "hakka-browser/elements": [...], "hakka-browser/elements/*": [...] }`
  pointing straight at `src/ui/elements/*`. Resolving through package.json
  `exports` here would point at `dist/types/...`, which doesn't exist yet
  mid-build — that same `tsc` pass is what emits it. This is a circular
  dependency an in-repo package can't have on itself; `paths` sidesteps the
  cycle by resolving to source instead. The emitted dist import specifier is
  untouched by this — `paths` only affects resolution during type-checking.
- **`tsconfig.react.build.json`** (used only by the `react` entry in
  `tsdown.config.ts`) explicitly clears `paths: {}`. If it inherited
  `tsconfig.json`'s `paths`, rolldown would resolve the self-referenced
  `hakka-browser/elements/*` specifier to a real file inside the project and
  stop treating it as external — `neverBundle` matches the bare specifier,
  not a resolved path, so a `paths`-resolved import silently defeats it. With
  `paths` cleared, resolution falls through to this package's own `exports`
  map instead — real self-referencing package resolution, exactly what an
  external consumer gets — which requires `dist/elements` and
  `dist/types/ui/elements` to already exist. That's why the `react` tsdown
  entry has to run after the `vite build --mode elements` and
  `tsc -p tsconfig.build.json` steps in the `build` script, in that order.

## neverBundle regex rationale

The `react` entry in `tsdown.config.ts` sets
`deps: { neverBundle: [/^hakka-browser\//, 'hakka-core', 'react', 'react-dom'] }`.
`hakka-core`/`react`/`react-dom` are plain string matches — tsdown also
externalizes anything already listed in this package's own
`dependencies`/`peerDependencies`, which already covers them, but listing them
explicitly keeps the intent visible regardless of that list changing later.

`/^hakka-browser\//` is a real `RegExp`, not a string, and that's
load-bearing: this package can't list itself in its own
`dependencies`/`peerDependencies` (that would be a self-reference), so
tsdown's package.json-derived externalization never sees `hakka-browser` as a
known dependency. A plain string entry only does an exact match
(`item === id` — no prefix or subpath matching), so it wouldn't match every
`hakka-browser/elements/*` subpath each React wrapper imports. Without the
regex, rolldown resolves the self-import straight through to the six
elements' own Solid source (via `tsconfig.react.build.json`'s cleared
`paths` — see above — falling through to real package resolution, which the
regex then has to actually externalize) and inlines the entire
Inspector-adjacent tree into `dist/react` a second time. That's exactly the
tree-shaking regression ADR 0003 (c) rejects.

## Verifying a change here

Any change to `vite.config.ts` or `tsdown.config.ts` should be verified with:

1. **Dist parity.** Build on the base commit, record the sorted file list and
   per-file gzip byte size of `dist/`. Build again with your change. The file
   set must be identical (hash-suffixed chunk names may differ in their
   suffix only) and every file's gzip size must be within ±1% of before.
2. `bun run --cwd packages/hakka-browser test` — the full Vitest suite.
3. `bunx tsgo --noEmit` — clean.
4. `node scripts/ui-token-check.mjs` — passes.
5. `node scripts/web-size-gate.mjs` — reports the _same_ numbers as before
   your change (already-over-budget is fine and expected; a _changed_ number
   in either direction means the build config changed what actually ships,
   which needs its own review).
