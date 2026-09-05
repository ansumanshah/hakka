import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import solid from '@solidjs/vite-plugin'
import { minify } from 'terser'
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
    enforce: 'pre',
    apply: 'build',
    load(id) {
      if (!id.endsWith('/ui/tokens.css?raw')) return null
      // Token CSS is also embedded verbatim; handle it before Vite's raw loader.
      const css = readFileSync(id.slice(0, -4), 'utf8')
      return { code: `export default ${JSON.stringify(minifyCss(css))}`, map: null }
    },
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

const ELEMENTS_DIR = resolve(import.meta.dirname, 'src/ui/elements')

// Vite's separate worker sub-build does NOT inherit `build.minify: 'terser'`
// — every mode below that bundles the inline store Worker needs this too, or
// the budget silently balloons. Why: docs/contributing/build-pipeline.md
// § "Worker doesn't inherit minify".
const WORKER_MINIFY_FIX = {
  rollupOptions: { output: { minify: true as const } },
  // Compress the completed worker before Vite embeds it in the parent bundle.
  // Parent ESM output keeps its PURE annotations for downstream tree-shaking.
  plugins: (): Plugin[] => [
    {
      name: 'hakka-compress-inline-worker',
      async generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue
          const result = await minify(output.code, { compress: { passes: 3 } })
          if (result.code) output.code = result.code
        }
      },
    },
  ],
}

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
          entry: resolve(import.meta.dirname, 'src/workerCapture.ts'),
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
            // Share one compression dictionary for modules shared by at least six entries.
            codeSplitting: { groups: [{ name: 'runtime', minShareCount: 6 }] },
            // Keep the shared filename class stable for the size gate. The runtime
            // group contains the common core, styles and store modules; retain the
            // worker/web names for shared chunks emitted outside that group.
            // Match framework chunks by name so async Detail-only internals are
            // not mistaken for runtime code shared by every element.
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
        entry: resolve(import.meta.dirname, 'src/index.ts'),
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
