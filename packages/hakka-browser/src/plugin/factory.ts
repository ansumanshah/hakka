/**
 * The Hakka build-tool plugin, authored once with `unplugin` so the same logic
 * ships to every bundler. Bundler-specific entry points live in `./vite`,
 * `./webpack`, … and re-export the matching factory from here.
 *
 * Injection is HTML-based (a module `<script>` that starts the overlay), so the
 * supported bundlers are the ones with an HTML pipeline: Vite (via
 * `transformIndexHtml`) and webpack / rspack (via `html-webpack-plugin`'s
 * `beforeEmit` hook). Bundlers without an HTML step use the one-line manual
 * setup (`import { start } from 'hakka-browser'; start()`).
 */
import { createRequire } from 'node:module'

import type { UnpluginFactory } from 'unplugin'
import { createUnplugin } from 'unplugin'

import { buildInjectSnippet, injectIntoHtml, type HakkaPluginOptions } from './inject'

// Minimal structural shapes so we don't need `webpack` / `html-webpack-plugin`
// as type dependencies (both are optional peers, resolved at runtime only).
interface WebpackCompilerLike {
  options: { mode?: string }
  hooks: { compilation: { tap(name: string, fn: (compilation: object) => void): void } }
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
  getHooks?(compilation: object): HtmlHooks
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

/**
 * webpack / rspack: inject the overlay script via html-webpack-plugin's beforeEmit hook.
 *
 * UNVERIFIED RISK, worth resolving before promoting these two adapters. Vite's
 * dev server had a real bug here (see the `order` comment below): an injected
 * inline module script whose `import` uses a BARE specifier only works if
 * something rewrites that specifier before it reaches the browser. Vite has
 * `devHtmlHook` for exactly that. webpack has no equivalent: `beforeEmit` fires
 * at emit time, after the compilation is sealed, so the string spliced in here
 * is never part of the module graph and never resolved. That reasoning says the
 * emitted HTML would carry a raw `from 'hakka-browser'` the browser cannot
 * resolve, the same failure Vite had.
 *
 * It is NOT confirmed: neither webpack nor html-webpack-plugin is installed in
 * this repo, so no probe app was built to prove it either way. Do not treat this
 * as a known bug or a known-good path. Confirm with a real webpack app, and if
 * it reproduces, the fix is a different snippet for these adapters (a resolved
 * URL or a real emitted entry chunk), not an ordering change.
 */
function installHtmlHook(
  compiler: WebpackCompilerLike,
  snippet: string,
  devOnly: boolean,
  nonce: string | undefined,
): void {
  if (devOnly && compiler.options.mode === 'production') return
  compiler.hooks.compilation.tap(PLUGIN_NAME, (compilation) => {
    let plugin: HtmlWebpackPluginStatic
    try {
      // Optional peer: only injects when html-webpack-plugin is installed.
      plugin = createRequire(import.meta.url)('html-webpack-plugin') as HtmlWebpackPluginStatic
    } catch {
      return
    }
    const hooks = plugin.getHooks?.(compilation)
    hooks?.beforeEmit?.tapAsync(PLUGIN_NAME, (data, cb) => {
      data.html = injectIntoHtml(data.html, snippet, nonce)
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
      installHtmlHook(compiler as unknown as WebpackCompilerLike, snippet, devOnly, options.nonce)
    },
    rspack(compiler) {
      installHtmlHook(compiler as unknown as WebpackCompilerLike, snippet, devOnly, options.nonce)
    },
  }
}

export type { HakkaPluginOptions }

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)
