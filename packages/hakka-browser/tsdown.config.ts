import { defineConfig } from 'tsdown'

// Off on purpose in both entries below: this package (+ hakka-rozenite) was
// 6.2 MB of the repo's 7 MB of published .map files. hakka-core/hakka-node/
// hakka keep theirs. See CHANGELOG and docs/contributing/build-pipeline.md
// § "Sourcemaps off".
const SOURCEMAP_OFF = false as const

/**
 * Two independent entry points, one array config, built concurrently in a
 * single tsdown/rolldown process (was two sequential `tsdown --config ...`
 * invocations). Safe here — disjoint `outDir`s, disjoint `entry` sets, both
 * `clean: false` — but a real concurrency change from before the merge. Why
 * that's fine, and what would make it not fine: docs/contributing/build-pipeline.md
 * § "tsdown array concurrency".
 */
export default defineConfig([
  {
    // Node-side build-tool plugin entry points (hakka-browser/vite, /webpack,
    // /rspack) → dist/plugin. `clean: false` so it never wipes the vite output
    // that already ran (package.json's `build` script runs vite first).
    entry: ['src/plugin/vite.ts', 'src/plugin/webpack.ts', 'src/plugin/rspack.ts'],
    outDir: 'dist/plugin',
    format: ['esm'],
    dts: true,
    sourcemap: SOURCEMAP_OFF,
    treeshake: true,
    target: 'es2022',
    clean: false,
    deps: { neverBundle: ['vite', 'webpack', 'html-webpack-plugin', 'hakka-browser', 'unplugin'] },
  },
  {
    // `hakka-browser/react` — thin React 19 wrappers over
    // `hakka-browser/elements` (ADR 0003 (e)) → dist/react.
    entry: ['src/react/index.ts'],
    outDir: 'dist/react',
    format: ['esm'],
    dts: true,
    sourcemap: SOURCEMAP_OFF,
    treeshake: true,
    target: 'es2022',
    clean: false,
    // NOT tsconfig.json — its `paths` resolves `hakka-browser/elements/*`
    // straight to source for `tsc -p tsconfig.build.json`'s type-check pass,
    // which would defeat `neverBundle` below (it matches the bare specifier,
    // not a resolved path). Why this is a real circular-resolution trap and
    // not over-caution: docs/contributing/build-pipeline.md
    // § "paths circular-resolution trick".
    tsconfig: './tsconfig.react.build.json',
    // A real RegExp, not a string — matches every `hakka-browser/elements/*`
    // subpath each wrapper imports, not just an exact `'hakka-browser'`
    // specifier (tsdown's string matching is `item === id`, no prefix
    // matching). `hakka-core`/`react`/`react-dom` are already externalized via
    // this package's own dependencies/peerDependencies; listed explicitly too
    // for clarity. Why `hakka-browser` can't just go in `dependencies`
    // instead: docs/contributing/build-pipeline.md § "neverBundle regex rationale".
    deps: { neverBundle: [/^hakka-browser\//, 'hakka-core', 'react', 'react-dom'] },
  },
])
