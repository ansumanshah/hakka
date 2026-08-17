#!/usr/bin/env node
/**
 * web-size-gate — gzip bundle-size report + regression gate for hakka-browser.
 *
 * Measures the raw and gzipped size of the shipped web bundles and fails (exit 1)
 * if any exceeds its budget. Mirrors `scripts/android-size-gate.sh` for the web
 * target. Run after building: `bun run --cwd packages/hakka-browser build`.
 *
 * The ESM build code-splits the heavy Solid UI into lazy, content-hashed chunks so
 * the eager `import 'hakka-browser'` path stays tiny (a regression here means the UI
 * leaked into the eager entry). The IIFE is the all-in-one `<script>` bundle.
 *
 * Per-line budgets (gzip bytes) override via env:
 *   HAKKA_WEB_ESM_BUDGET · HAKKA_WEB_GLOBAL_BUDGET · HAKKA_WEB_WORKER_BUDGET · HAKKA_WEB_LAZY_BUDGET
 *   HAKKA_COMPONENTS_SHARED_BUDGET · HAKKA_COMPONENTS_LAZY_BUDGET
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = resolve(ROOT, 'packages/hakka-browser/dist')

const NAMED = {
  // Tight budget on the eager entry: it must stay a bare launcher (~2.7 KB). The
  // #1 regression risk is someone statically importing UI/panel code into it —
  // this catches that immediately.
  'hakka-browser.js': { label: 'ESM eager entry', budget: Number(process.env.HAKKA_WEB_ESM_BUDGET) || 5 * 1024 },
  'hakka-browser.global.js': {
    // The IIFE <script> drop-in is all-in-one by construction: dynamic imports
    // inline into the single file, so it carries the engine + the entire Solid
    // UI + the worker (unlike the ESM entry, which code-splits the UI). Its
    // size tracks total inspector code, not the eager cost npm users pay.
    //
    // The inline store Worker (`?worker&inline`) can't be split out of the
    // single-<script> bundle: vite.config.ts builds `formats: ['es', 'iife']`
    // from one shared rolldown() graph, and a non-inline worker resolves to a
    // host-root absolute asset path for the IIFE build too. Vite only
    // auto-minifies a `?worker&inline` sub-bundle when `build.minify` is
    // `'oxc'` or `false` — `'terser'` falls through to no minification for
    // that inner build, so an explicit `worker: { rollupOptions: { output: {
    // minify: true } } }` is required in vite.config.ts or this budget
    // balloons on an otherwise-unrelated change.
    // Re-baselined 2026-08-16 (120 -> 140 KB) after the Solid 2.0 RC migration
    // (task #35/#36). The 120 KB line was set pre-migration; Solid 2.0 RC's
    // own runtime carries a documented ~6% fixed-cost bundle-size increase
    // over 1.9.14 (packages/hakka-bench/RESULTS.md, "confirmed by re-running
    // the gate against the pre-adoption commit"), landing the SHIP-2.0
    // baseline at 131.95 KB before any 2.0-native feature work. Two
    // deliberate additions on top of that (CrashBoundary's root `<Errored>`
    // crash containment, Detail's async body memo) added another +1.9%
    // (documented in RESULTS.md), and the ongoing component-split pass
    // (task #51) adds prop-boundary overhead on top of that. None of these
    // are reducible without reverting Solid 2.0 or the crash-containment
    // safety net, so the honest budget is measured-current (136.82 KB as of
    // this re-baseline, itself after a terser passes:2->3 bump) plus ~2.3%
    // headroom, not a number chosen to flatter a regression. Re-derive with
    // `node scripts/web-size-gate.mjs` after `bun run --cwd
    // packages/hakka-browser build`.
    label: 'IIFE (<script>)',
    budget: Number(process.env.HAKKA_WEB_GLOBAL_BUDGET) || 140 * 1024,
  },
  'worker.js': {
    // workerCapture.ts's own build (vite.config.ts's `worker` mode, `hakka-browser/worker`)
    // — a separate Vite config from the main bundle, so it needs its own
    // matching minify settings (terser, same compress passes as
    // vite.config.ts) or it silently ships less-optimized code.
    label: 'Worker capture shim',
    budget: Number(process.env.HAKKA_WEB_WORKER_BUDGET) || 23 * 1024,
  },
}
// Lazy, content-hashed UI chunks, budgeted as one total. RulesTab's Mock/
// Breakpoints/Throttle sub-tabs are each their own lazy() chunk — smaller
// per-session download (only the tab a developer opens), at the cost of each
// split-off chunk re-paying its own module-wrapper overhead in this gate's
// sum-of-every-chunk accounting. The ESM `register` chunk also embeds the
// same inline store-Worker payload as the IIFE bundle above, so it needs the
// same worker-output minification.
//
// Re-baselined 2026-08-16 (128 -> 148 KB) alongside the IIFE line above —
// same Solid 2.0 RC fixed cost, same arithmetic; see the comment on
// 'hakka-browser.global.js' above for the full justification. Measured
// current total was 145.69 KB (35 chunks) at re-baseline time; this budget
// gives it the same ~1.6% headroom.
const LAZY_BUDGET = Number(process.env.HAKKA_WEB_LAZY_BUDGET) || 148 * 1024

const kb = (n) => `${(n / 1024).toFixed(2)} KB`
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)
const gz = (buf) => gzipSync(buf, { level: 9 }).length

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST} not found — run \`bun run --cwd packages/hakka-browser build\` first`)
  process.exit(1)
}

const jsFiles = readdirSync(DIST).filter((f) => f.endsWith('.js'))
let failed = false
const rows = []

// Named entry points (exact filenames).
for (const [file, meta] of Object.entries(NAMED)) {
  if (!jsFiles.includes(file)) {
    console.error(`✗ missing dist file: ${file}`)
    failed = true
    continue
  }
  const buf = readFileSync(resolve(DIST, file))
  const g = gz(buf)
  const over = g > meta.budget
  if (over) failed = true
  rows.push({ label: meta.label, raw: buf.length, gz: g, budget: meta.budget, over })
}

// Lazy, content-hashed UI chunks (everything else) — budgeted as a single total.
const lazy = jsFiles.filter((f) => !(f in NAMED))
if (lazy.length > 0) {
  let raw = 0
  let g = 0
  for (const f of lazy) {
    const buf = readFileSync(resolve(DIST, f))
    raw += buf.length
    g += gz(buf)
  }
  const over = g > LAZY_BUDGET
  if (over) failed = true
  rows.push({ label: `Lazy UI chunks (${lazy.length})`, raw, gz: g, budget: LAZY_BUDGET, over })
}

console.log('\nhakka-browser bundle sizes (gzip)\n')
console.log(`  ${pad('Bundle', 24)} ${padL('raw', 11)} ${padL('gzip', 11)} ${padL('budget', 11)}  status`)
console.log(`  ${'-'.repeat(24)} ${'-'.repeat(11)} ${'-'.repeat(11)} ${'-'.repeat(11)}  ------`)
for (const r of rows) {
  console.log(
    `  ${pad(r.label, 24)} ${padL(kb(r.raw), 11)} ${padL(kb(r.gz), 11)} ${padL(kb(r.budget), 11)}  ${r.over ? 'OVER' : 'ok'}`,
  )
}
console.log('')

// ── hakka-browser/elements — per-element budgets (ADR 0003 (c)) ──
// Additive to the hakka-browser gate above: six standalone custom elements, each
// its own Vite lib-mode entry (packages/hakka-browser/vite.config.ts's `elements` mode), built
// from the same packages/hakka-browser/src/ui/elements/*.tsx source the Inspector shell
// itself imports, into a sibling dist/elements/ dir — not a fork, and not a
// dependency on the Inspector-shell dist above (formerly a separate
// `hakka-components` package; merged into hakka-browser as a second build/exports
// subpath, same source, same independent per-element bundles). Soft-skips
// (does not fail the gate) if this hasn't been built yet — additive-only, so
// a CI run that doesn't build it yet never regresses.
const COMPONENTS_DIST = resolve(ROOT, 'packages/hakka-browser/dist/elements')

if (existsSync(COMPONENTS_DIST)) {
  const componentFiles = readdirSync(COMPONENTS_DIST).filter((f) => f.endsWith('.js'))
  const readCode = (f) => readFileSync(resolve(COMPONENTS_DIST, f), 'utf8')
  // Only static `from "./x.js"` imports count toward "own weight" — a
  // dynamic `import("./x.js")` (e.g. a lazy-loaded panel) is a deferred,
  // click-triggered fetch, not part of what a bare `<hakka-x>` mount pays for.
  const staticImportsOf = (file) => [...readCode(file).matchAll(/from"\.\/([^"]+\.js)"/g)].map((m) => m[1])

  /** Every file `entry` statically pulls in, transitively, excluding any
   * `shared-*.js` chunk (measured as its own bucket below — Rollup's
   * hash-named chunk shared by every entry needing solid-js/solid-element/
   * the hakka-core query subset/the reused `styles.ts` CSS/the store client). */
  function ownChunksOf(entry) {
    const seen = new Set()
    const walk = (file) => {
      if (seen.has(file) || !componentFiles.includes(file)) return
      seen.add(file)
      for (const dep of staticImportsOf(file)) {
        if (dep.startsWith('shared-')) continue
        walk(dep)
      }
    }
    walk(entry)
    return seen
  }

  const gzOf = (file) => gz(readFileSync(resolve(COMPONENTS_DIST, file)))
  const ownWeightOf = (entry) => [...ownChunksOf(entry)].reduce((sum, f) => sum + gzOf(f), 0)

  // Each budget is that element's "own weight": entry shim + whatever
  // chunk(s) ONLY that entry statically imports (Icons.tsx, JsonViewer.tsx's
  // static import from json-tree, TraceWaterfall.tsx's from waterfall, etc.)
  // — see staticImportsOf/ownChunksOf above.
  const ELEMENT_BUDGETS = {
    'request-list.js': { label: '<hakka-request-list>', budget: 9 * 1024 },
    'request-detail.js': { label: '<hakka-request-detail>', budget: 10 * 1024 },
    'waterfall.js': { label: '<hakka-waterfall>', budget: 3 * 1024 },
    'filter-bar.js': { label: '<hakka-filter-bar>', budget: 5 * 1024 },
    'stats.js': { label: '<hakka-stats>', budget: 5 * 1024 },
    'json-tree.js': { label: '<hakka-json-tree>', budget: 3 * 1024 },
  }

  const componentRows = []
  // Every file some element's `ownChunksOf()` walk actually reaches — used
  // below to find what's left over (the lazy() chunks below never get
  // statically imported by any entry, so this walk never visits them).
  const attributed = new Set(['index.js'])
  for (const [file, meta] of Object.entries(ELEMENT_BUDGETS)) {
    if (!componentFiles.includes(file)) {
      console.error(`✗ missing hakka-browser/elements dist file: ${file}`)
      failed = true
      continue
    }
    const g = ownWeightOf(file)
    const chunks = ownChunksOf(file)
    for (const f of chunks) attributed.add(f)
    const raw = [...chunks].reduce((sum, f) => sum + readFileSync(resolve(COMPONENTS_DIST, f)).length, 0)
    const over = g > meta.budget
    if (over) failed = true
    componentRows.push({ label: meta.label, raw, gz: g, budget: meta.budget, over })
  }

  // The shared-runtime bucket every element above excludes from its own row:
  // solid-js + solid-element + the hakka-core query subset the six elements
  // share (compileQuery/sortRequests/createGroupCache/types), plus
  // `hakka-browser`'s full `styles.ts` CSS (reused verbatim for pixel-identical
  // rendering rather than a per-component subset extraction) and
  // `worker/storeClient.ts`'s store client, which embeds the capture-engine
  // code twice (the in-process fallback path, plus a second string-embedded
  // copy for the `?worker&inline` Worker build). This package's own
  // CSS-minify + worker-output-minify passes (mirroring
  // packages/hakka-browser/vite.config.ts) keep this bucket well under budget; a real
  // per-component CSS subset, or a lighter read-only store client for these
  // display-only elements, would shrink it further.
  //
  // Re-budgeted 75 -> 85 KB (task #52). Not new weight — this bucket was
  // always SUPPOSED to hold the solid-js/@solidjs runtime and the worker/
  // store-client chunk (both named explicitly two paragraphs up), but
  // vite.config.ts's `chunkFileNames` pinning predicate never matched
  // either one, so their bytes were misattributed instead of counted here:
  // the ~13.3 KB solid-js/@solidjs runtime chunk was double-counted into
  // EVERY per-element row above (why all six were reporting 2-5x their
  // budget), and the ~25.3 KB worker/store-client chunk landed in "Lazy
  // component chunks" below even though it's eagerly reachable from every
  // entry (mischaracterized as opt-in when it's paid on every mount). Fixing
  // the predicate to pin both here (by `chunkInfo.name`, not a moduleIds
  // path substring — see vite.config.ts's comment on why) moved that
  // existing weight into its correctly-documented home instead of adding
  // any. Measured after the fix: 82.55 KB (shared-dist 31.71 + shared-tags
  // 12.25 + shared-web 13.28 + shared-worker 25.30). 85 KB gives ~3.0%
  // headroom, matching the re-budget style of commit fd24da4 (that pass's
  // IIFE/lazy-chunk lines took ~1.6-2.3%; this bucket gets a touch more
  // since it now aggregates four independently-varying chunks instead of
  // two). Re-derive with `node scripts/web-size-gate.mjs` after `bun run
  // --cwd packages/hakka-browser build`.
  const sharedFiles = componentFiles.filter((f) => f.startsWith('shared-'))
  for (const f of sharedFiles) attributed.add(f)
  if (sharedFiles.length > 0) {
    const raw = sharedFiles.reduce((sum, f) => sum + readFileSync(resolve(COMPONENTS_DIST, f)).length, 0)
    const g = sharedFiles.reduce((sum, f) => sum + gzOf(f), 0)
    const budget = Number(process.env.HAKKA_COMPONENTS_SHARED_BUDGET) || 85 * 1024
    const over = g > budget
    if (over) failed = true
    componentRows.push({ label: 'Shared runtime chunk', raw, gz: g, budget, over })
  }

  // Lazy component chunks: every dist `.js` NOT reached by any named entry's
  // static-import walk above, not a `shared-*` chunk, and not `index.js`.
  // Mirrors the hakka-browser section's "Lazy UI chunks" bucket above: each
  // element `lazy()`-loads its real Solid component on first render, so this
  // is a real per-user cost (bytes fetched only once someone actually opens
  // the element) that `ownWeightOf()` doesn't cover — it only follows static
  // imports, and a `lazy()` import is dynamic by definition.
  const lazyFiles = componentFiles.filter((f) => !attributed.has(f))
  if (lazyFiles.length > 0) {
    const raw = lazyFiles.reduce((sum, f) => sum + readFileSync(resolve(COMPONENTS_DIST, f)).length, 0)
    const g = lazyFiles.reduce((sum, f) => sum + gzOf(f), 0)
    const budget = Number(process.env.HAKKA_COMPONENTS_LAZY_BUDGET) || 27 * 1024
    const over = g > budget
    if (over) failed = true
    componentRows.push({ label: `Lazy component chunks (${lazyFiles.length})`, raw, gz: g, budget, over })
  }

  // Root aggregate entry (`.` export) — re-exports all six `register*()`
  // functions; tiny by construction (a thin re-export shim, ADR 0003 (c)'s
  // "root re-exports all six, for a consumer who wants everything").
  if (componentFiles.includes('index.js')) {
    const g = gzOf('index.js')
    const budget = 1024
    const over = g > budget
    if (over) failed = true
    componentRows.push({
      label: 'index.js (root aggregate)',
      raw: readFileSync(resolve(COMPONENTS_DIST, 'index.js')).length,
      gz: g,
      budget,
      over,
    })
  }

  console.log('\nhakka-browser/elements bundle sizes (gzip)\n')
  console.log(`  ${pad('Bundle', 26)} ${padL('raw', 11)} ${padL('gzip', 11)} ${padL('budget', 11)}  status`)
  console.log(`  ${'-'.repeat(26)} ${'-'.repeat(11)} ${'-'.repeat(11)} ${'-'.repeat(11)}  ------`)
  for (const r of componentRows) {
    console.log(
      `  ${pad(r.label, 26)} ${padL(kb(r.raw), 11)} ${padL(kb(r.gz), 11)} ${padL(kb(r.budget), 11)}  ${r.over ? 'OVER' : 'ok'}`,
    )
  }
  console.log('')
} else {
  console.log(
    `\nhakka-browser/elements: dist not found at ${COMPONENTS_DIST} — skipping (run \`bun run --cwd packages/hakka-browser build\` first). Not a gate failure; this section is additive.\n`,
  )
}

if (failed) {
  console.error('Bundle-size gate FAILED — a bundle is over budget (or missing). Investigate before shipping.\n')
  process.exit(1)
}
console.log('All bundles within budget.\n')
