/**
 * The Hakka build-tool plugin, authored once with `unplugin` so the same logic
 * ships to every bundler. Bundler-specific entry points live in `./vite`,
 * `./webpack`, … and re-export the matching factory from here.
 *
 * Injection is HTML-based (Vite via `transformIndexHtml`; webpack/rspack via
 * html-webpack-plugin's `beforeEmit` hook), so the supported bundlers are the
 * ones with an HTML pipeline. Bundlers without an HTML step use the one-line
 * manual setup (`import { start } from 'hakka-browser'; start()`).
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { UnpluginFactory } from 'unplugin'
import { createUnplugin } from 'unplugin'

import { buildInjectSnippet, buildStartCall, injectExternalScriptsIntoHtml, type HakkaPluginOptions } from './inject'

// Minimal structural shapes so we don't need `webpack` / `html-webpack-plugin`
// as type dependencies (both are optional peers, resolved at runtime only).
interface WebpackCompilerLike {
  context: string
  options: { mode?: string }
  hooks: { compilation: { tap(name: string, fn: (compilation: WebpackCompilationLike) => void): void } }
}
interface AssetSourceLike {
  source(): string
  size(): number
}
interface WebpackCompilationLike {
  outputOptions: { publicPath?: unknown }
  emitAsset(name: string, source: AssetSourceLike): void
}
interface HtmlBeforeEmitData {
  html: string
}
interface HtmlHooks {
  beforeEmit?: {
    tapAsync(
      name: string,
      fn: (data: HtmlBeforeEmitData, cb: (err: unknown, data: HtmlBeforeEmitData) => void) => void,
    ): void
  }
}
interface HtmlWebpackPluginStatic {
  getHooks?(compilation: WebpackCompilationLike): HtmlHooks
}

const PLUGIN_NAME = 'hakka'

// `hakka-node` is an OPTIONAL peer — most apps never set `server: true` and
// pay nothing for it. Routed through a variable rather than a literal
// `import('hakka-node')` because a literal specifier fails typecheck for
// every consumer (the package isn't declared as a dependency here).
const HAKKA_NODE_SPECIFIER = 'hakka-node'

/**
 * Vite-only auto-registration for `server: true` — see `HakkaPluginOptions.server`.
 * Never throws: a missing/broken `hakka-node` peer logs one warning via the
 * caller's logger instead of crashing the dev server's startup.
 */
async function registerServerCapture(warn: (msg: string) => void): Promise<void> {
  try {
    const mod = (await import(HAKKA_NODE_SPECIFIER)) as { register?: (options?: Record<string, unknown>) => unknown }
    mod.register?.({})
  } catch (e: unknown) {
    warn(
      `[hakka] plugin option "server: true" needs the optional peer "hakka-node" to be installed ` +
        `(e.g. \`bun add -D hakka-node\`) — server-side capture was not started. ` +
        `(${e instanceof Error ? e.message : String(e)})`,
    )
  }
}

// webpack/rspack asset name for the injected loader — namespaced so a
// collision with a real app asset is vanishingly unlikely.
const HAKKA_ASSET_NAME = 'hakka-inject.js'

// Where to find the pre-built global bundle relative to THIS file, tried in
// order. Real usage only ever hits the first candidate: a published install
// runs the compiled `dist/plugin/factory-*.mjs`, one level below its sibling
// `dist/hakka-browser.global.js`. The second candidate exists only because
// this package's OWN test suite imports plugin code straight from
// `src/plugin/factory.ts` (source, not `dist/`) — there is no
// `src/hakka-browser.global.js` (the IIFE build is a `dist/`-only artifact of
// `vite.config.ts`'s `lib.formats`), so from source the real file is two
// levels up and back down into `dist/`.
const GLOBAL_BUNDLE_CANDIDATES = ['../hakka-browser.global.js', '../../dist/hakka-browser.global.js']

/**
 * webpack/rspack only. The pre-built, self-contained IIFE bundle this package
 * already ships for the framework-free "one `<script>` tag" path (exposes
 * `window.Hakka`). `installHtmlHook` reuses it instead of an ESM `import` —
 * see that function's doc for why. Read once and cached: the content is
 * static per process, and this can run once per rebuild in watch mode.
 */
let globalBundleCache: string | undefined
function readGlobalBundle(): string {
  if (globalBundleCache !== undefined) return globalBundleCache
  for (const candidate of GLOBAL_BUNDLE_CANDIDATES) {
    const path = fileURLToPath(new URL(candidate, import.meta.url))
    if (existsSync(path)) {
      globalBundleCache = readFileSync(path, 'utf8')
      return globalBundleCache
    }
  }
  throw new Error(
    '[hakka] could not find the pre-built dist/hakka-browser.global.js bundle needed to inject the ' +
      'webpack/rspack overlay. Run the hakka-browser package build (`npm run build`) first.',
  )
}

/**
 * Emit the global bundle and inject ordered classic scripts: beforeEmit cannot
 * resolve ESM imports. Resolve html-webpack-plugin from the consuming app for
 * linked and pnpm installs. The relative script path requires HTML and the asset
 * in the same output directory; nested multi-page output is not supported.
 */
function installHtmlHook(compiler: WebpackCompilerLike, options: HakkaPluginOptions, devOnly: boolean): void {
  if (devOnly && compiler.options.mode === 'production') return
  compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
    let plugin: HtmlWebpackPluginStatic
    try {
      // createRequire uses this path's directory; noop.js need not exist.
      plugin = createRequire(join(compiler.context, 'noop.js'))('html-webpack-plugin') as HtmlWebpackPluginStatic
    } catch {
      return
    }
    const hooks = plugin.getHooks?.(compilation)
    if (!hooks?.beforeEmit) return

    // Real asset, not an inline string — see bug #1 above.
    compilation.emitAsset(HAKKA_ASSET_NAME, {
      source: readGlobalBundle,
      size: () => Buffer.byteLength(readGlobalBundle(), 'utf8'),
    })
    const publicPath =
      typeof compilation.outputOptions.publicPath === 'string' && compilation.outputOptions.publicPath !== 'auto'
        ? compilation.outputOptions.publicPath
        : ''
    const src = `${publicPath}${HAKKA_ASSET_NAME}`
    const startCall = buildStartCall(options.start)

    hooks.beforeEmit.tapAsync(PLUGIN_NAME, (data, cb) => {
      data.html = injectExternalScriptsIntoHtml(data.html, src, startCall, options.nonce)
      cb(null, data)
    })
  })
}

const unpluginFactory: UnpluginFactory<HakkaPluginOptions | undefined> = (options = {}) => {
  const devOnly = options.devOnly !== false
  const snippet = buildInjectSnippet(options.start)

  return {
    name: PLUGIN_NAME,
    // Vite: inject a module script into index.html (dev only by default).
    vite: {
      apply: devOnly ? 'serve' : undefined,
      transformIndexHtml: {
        // MUST be 'pre', never 'post'. Vite's dev server runs the chain as
        // [...preHooks, htmlEnvHook, devHtmlHook, ...normalHooks, ...postHooks]
        // (`createDevHtmlTransformFn`). `devHtmlHook` is the pass that rewrites
        // each inline `<script type="module">` into a proxied module URL
        // (`?html-proxy&index=N.js`) so the browser can resolve bare specifiers
        // inside it. At 'post' our tag is added AFTER that pass has run, so the
        // injected `import { start } from 'hakka-browser'` is never proxied and
        // the browser throws "Failed to resolve module specifier". At 'pre' the
        // tag exists before devHtmlHook, gets proxied, and the overlay starts.
        // Regression covered by __tests__/viteTransform.test.ts, which drives a
        // real Vite dev server rather than asserting on the returned string.
        order: 'pre',
        handler() {
          return [
            {
              tag: 'script',
              attrs: { type: 'module', 'data-hakka': 'true', ...(options.nonce ? { nonce: options.nonce } : {}) },
              injectTo: 'body',
              children: snippet,
            },
          ]
        },
      },
      // Vite-only (see HakkaPluginOptions.server doc): Vite's dev server runs
      // in-process, so `configureServer` can register capture directly.
      // webpack/rspack have no equivalent — their dev servers front a
      // separate bundling process that doesn't own the app's server runtime.
      configureServer(server) {
        if (!options.server) return
        void registerServerCapture((msg) => server.config.logger.warn(msg))
      },
    },
    // webpack + rspack share the html-webpack-plugin hook surface. Neither
    // reads `options.server` — see the `configureServer` comment above.
    webpack(compiler) {
      installHtmlHook(compiler as unknown as WebpackCompilerLike, options, devOnly)
    },
    rspack(compiler) {
      installHtmlHook(compiler as unknown as WebpackCompilerLike, options, devOnly)
    },
  }
}

export type { HakkaPluginOptions }

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)
