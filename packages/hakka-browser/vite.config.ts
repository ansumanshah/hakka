import { resolve } from 'node:path'

import solid from '@solidjs/vite-plugin'
import { defineConfig, type Plugin } from 'vite'

/**
 * Conservative, dependency-free CSS minifier for the STYLES template literal
 * in `ui/styles.ts` (comments + whitespace only — never the space before `:`,
 * which can be a descendant combinator). Full rationale for why this exists
 * instead of a lightningcss/esbuild devDependency:
 * docs/contributing/build-pipeline.md § "CSS minifier scope". One definition
 * now, shared by the overlay and elements builds below (was duplicated).
 */
function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip /* ... */ comments
    .replace(/\s+/g, ' ') // collapse whitespace runs (incl. newlines/indent) to one space
    .replace(/([{;,:])\s+/g, '$1') // drop the space *after* a structural char
    .replace(/\s+([{;,}])/g, '$1') // drop the space *before* one (never `:` — see above)
    .replace(/;}/g, '}') // a trailing semicolon before a close brace is dead weight
    .trim()
}

/** Applies `minifyCss` to `ui/styles.ts`'s `STYLES` template literal at build
 * time only (`apply: 'build'` — dev + vitest keep it verbatim/readable). */
function minifyInlineStyles(): Plugin {
  const MARKER = '${TOKENS}\n'
  return {
    name: 'hakka-minify-inline-styles',
    apply: 'build',
    transform(code, id) {
      if (!id.endsWith('/ui/styles.ts')) return null
      const start = code.indexOf(MARKER)
      const end = code.lastIndexOf('`')
      // Shape changed since this plugin was written (e.g. STYLES restructured)
      // — fail open and ship the readable, unminified source rather than
      // risk mangling it with a stale assumption.
      if (start < 0 || end <= start) return null
      const head = code.slice(0, start + MARKER.length)
      const cssBody = code.slice(start + MARKER.length, end)
      const tail = code.slice(end)
      const minified = minifyCss(cssBody).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
      return { code: `${head}${minified}${tail}`, map: null }
    },
  }
}

const ELEMENTS_DIR = resolve(__dirname, 'src/ui/elements')

// Vite's separate worker sub-build does NOT inherit `build.minify: 'terser'`
// — every mode below that bundles the inline store Worker needs this too, or
// the budget silently balloons. Why: docs/contributing/build-pipeline.md
// § "Worker doesn't inherit minify".
const WORKER_MINIFY_FIX = { rollupOptions: { output: { minify: true as const } } }

// Off on purpose in every mode below: this package (+ hakka-rozenite) was
// 6.2 MB of the repo's 7 MB of published .map files. hakka-core/hakka-node/
// hakka keep theirs. See CHANGELOG and build-pipeline.md § "Sourcemaps off".
const SOURCEMAP_OFF = false as const

/**
 * One config, three build passes, run in sequence by package.json's `build`
 * script (`vite build && vite build --mode worker && vite build --mode
 * elements && ...`) — ordering and `emptyOutDir` interplay are load-bearing,
 * not incidental. Details: docs/contributing/build-pipeline.md
 * § "Build ordering".
 *
 * Mode-string / env safety: verified no first-party source and no installed
 * dependency branches on `import.meta.env.MODE`/`process.env.NODE_ENV` in a
 * way that changes behavior across these three modes — Vite pins
 * `process.env.NODE_ENV` to `'production'` for every `vite build` regardless
 * of `--mode`. The one confirmed-but-dormant exception (an internal
 * `config.mode` branch in `@solidjs/vite-plugin`'s server-functions
 * sub-plugin, unreachable here — no `use server`/env-schema code exists in
 * this package) is pinned closed below via `define` anyway, as cheap
 * defense-in-depth. Full investigation + how dist-parity CI re-verifies it on
 * every build: docs/contributing/build-pipeline.md § "Mode strings and env
 * safety".
 */
export default defineConfig(({ mode }) => {
  if (mode === 'worker') {
    // Second build pass: the in-worker capture shim (`hakka-browser/worker`).
    // ESM-only, no UI, no solid() plugin — just the core interceptors,
    // inlined — so a Worker can `import { captureInWorker } from
    // 'hakka-browser/worker'` with zero peers. `emptyOutDir: false` because
    // this must append to `dist/` after the main build wipes it, without
    // clearing `hakka-browser.js` / `hakka-browser.global.js`.
    return {
      define: { 'import.meta.env.MODE': JSON.stringify('production') },
      build: {
        target: 'es2020',
        lib: {
          entry: resolve(__dirname, 'src/workerCapture.ts'),
          formats: ['es'],
          fileName: () => 'worker.js',
        },
        minify: 'terser',
        terserOptions: { compress: { passes: 2 } },
        sourcemap: SOURCEMAP_OFF,
        emptyOutDir: false,
      },
    }
  }

  if (mode === 'elements') {
    // Third build pass: `hakka-browser/elements/*` (ADR 0003 (c) — "shared
    // source, separate build"). Six standalone custom elements built from
    // the same `src/ui/elements/*.tsx` source the Inspector shell itself
    // imports — not a fork, not a re-export of the shell's dist. `formats: ['es']`
    // only (no iife/cjs) so Rollup code-splits shared deps into their own
    // chunk(s); importing one subpath only fetches that entry's chunk plus
    // the shared chunk(s) it needs. See build-pipeline.md § "Elements build".
    return {
      define: { 'import.meta.env.MODE': JSON.stringify('production') },
      plugins: [solid(), minifyInlineStyles()],
      build: {
        outDir: 'dist/elements',
        target: 'es2020',
        lib: {
          entry: {
            'request-list': resolve(ELEMENTS_DIR, 'request-list.tsx'),
            'request-detail': resolve(ELEMENTS_DIR, 'request-detail.tsx'),
            waterfall: resolve(ELEMENTS_DIR, 'waterfall.tsx'),
            'filter-bar': resolve(ELEMENTS_DIR, 'filter-bar.tsx'),
            stats: resolve(ELEMENTS_DIR, 'stats.tsx'),
            'json-tree': resolve(ELEMENTS_DIR, 'json-tree.tsx'),
            index: resolve(ELEMENTS_DIR, 'index.ts'),
          },
          formats: ['es'],
        },
        minify: 'terser',
        terserOptions: { compress: { passes: 2 } },
        sourcemap: SOURCEMAP_OFF,
        emptyOutDir: true,
        cssCodeSplit: false,
        rollupOptions: {
          output: {
            // Pins the shared-runtime chunk to a stable `shared-[name]-[hash].js`
            // name instead of relying on Rollup's auto-naming heuristic, so
            // scripts/web-size-gate.mjs can budget it separately from each
            // element's own weight. Full rule + why it's architectural, not
            // cosmetic: docs/contributing/build-pipeline.md § "Shared chunk naming".
            //
            // Task #52: two markers were MISSING until this pass — the same
            // class of bug the original three were written to prevent (see
            // that doc section: "Rollup's default auto-naming heuristic for
            // a chunk shared by every entry is an implementation detail, not
            // a stable contract"). Solid 2.0 RC split the single `solid-js`
            // package into `solid-js` + `@solidjs/signals` + `@solidjs/web` +
            // `@solidjs/element`, which reshaped Rollup's default chunk
            // graph enough that the framework runtime landed in its own
            // `web-[hash].js` chunk instead of being folded into the
            // `shared.ts`/`tags.ts` chunk it used to share a boundary with.
            // Unpinned, that ~13.3 KB chunk (gzip) is statically imported by
            // every one of the six entries, so the gate's per-element walk
            // (which only stops recursing at an ALREADY-`shared-`-prefixed
            // chunk) counted its full weight six times over — once inside
            // each element's own budget row, instead of once in the shared
            // bucket. Same story for `src/worker/` (the store client
            // `elements/shared.ts` re-exports as `sharedStore()`, per that
            // file's own module doc): eagerly reachable from every entry via
            // `elements/shared.ts`, but never matched a marker, so its
            // ~25.3 KB landed in the "Lazy component chunks" bucket instead
            // — a real chunk this gate mischaracterized as opt-in/deferred
            // when it is actually paid by every element on mount.
            //
            // These two are matched on Rollup's own auto-derived
            // `chunkInfo.name` ('web' / 'worker'), NOT a `moduleIds` path
            // substring like the three markers above. A path substring is
            // wrong here: `@solidjs/signals` ships `optimistic.js`/
            // `verdict.js` (async-resource internals) that only
            // `Detail.tsx`'s async body memo uses — Rollup correctly folds
            // those two files into Detail's OWN lazy chunk (nothing else
            // reaches them), not into the six-entries-wide `web` chunk. A
            // `moduleIds.some(id => id.includes('@solidjs/'))` check matches
            // Detail's chunk too (it contains those 2 files) and would
            // wrongly pin ~11 KB of genuine per-element Detail weight into
            // the shared bucket. Matching the chunk's own resolved identity
            // instead of its contents avoids that false positive; verify
            // after any dependency bump by re-running this build and
            // confirming `dist/elements/Detail-*.js` (no prefix) stays
            // separate from `dist/elements/shared-web-*.js`.
            chunkFileNames: (chunkInfo) => {
              const isSharedRuntime =
                chunkInfo.name === 'web' ||
                chunkInfo.name === 'worker' ||
                chunkInfo.moduleIds.some(
                  (id) =>
                    id.endsWith('/elements/shared.ts') ||
                    id.endsWith('/elements/tags.ts') ||
                    id.includes('/packages/hakka-core/'),
                )
              return isSharedRuntime ? 'shared-[name]-[hash].js' : '[name]-[hash].js'
            },
          },
        },
      },
      worker: WORKER_MINIFY_FIX,
    }
  }

  // Default (no --mode flag → Vite resolves `mode: 'production'`): the
  // overlay build. Two self-contained bundles (Solid + hakka-core inlined):
  //  - ESM  `dist/hakka-browser.js`        — `import { hakka } from 'hakka-browser'`
  //  - IIFE `dist/hakka-browser.global.js` — `<script>` drop-in, exposes `window.Hakka`
  return {
    plugins: [solid(), minifyInlineStyles()],
    build: {
      target: 'es2020',
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'Hakka',
        formats: ['es', 'iife'],
        fileName: (format) => (format === 'iife' ? 'hakka-browser.global.js' : 'hakka-browser.js'),
      },
      // terser beats esbuild by a few % on gzip for the shipped bundles —
      // worth the extra build time for a library others embed. passes: 3
      // (up from 2) squeezes a further ~0.3% gzip out of this bundle only —
      // safe (no `unsafe_*`/`toplevel` flags, so no behavior or export-name
      // risk), just more compress iterations against the same safe ruleset.
      minify: 'terser',
      terserOptions: { compress: { passes: 3 } },
      sourcemap: SOURCEMAP_OFF,
      emptyOutDir: true,
      cssCodeSplit: false,
    },
    worker: WORKER_MINIFY_FIX,
  }
})
