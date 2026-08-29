/**
 * Shared, bundler-agnostic injection logic for the Hakka build-tool plugins.
 *
 * Two distinct strategies live here, because Vite and webpack/rspack differ
 * in a way that isn't cosmetic:
 *
 *  - Vite (`buildInjectSnippet`): an inline `<script type="module">` that
 *    `import`s `hakka-browser` by bare specifier. Safe ONLY because Vite's
 *    `devHtmlHook` rewrites that specifier into a proxied, resolvable URL
 *    before the browser sees it — see `factory.ts`'s `order: 'pre'` comment.
 *  - webpack/rspack (`buildStartCall` + `injectExternalScriptsIntoHtml`):
 *    CLASSIC (non-module) scripts with no `import` at all. Neither bundler
 *    has an equivalent HTML-transform-time rewrite, so an ESM bare specifier
 *    here reaches the browser unresolved and throws — confirmed with a real
 *    build, see `factory.ts`'s `installHtmlHook` doc. The fix is to sidestep
 *    module resolution entirely by reusing the pre-built, self-contained
 *    global bundle this package already ships for the framework-free
 *    `<script>`-tag path (`dist/hakka-browser.global.js`, exposes
 *    `window.Hakka`), loaded as a real emitted asset.
 */

export interface HakkaPluginOptions {
  /**
   * Only inject during dev (Vite `serve`, webpack `mode !== 'production'`).
   * Default `true`. You almost never want the overlay in a production build.
   */
  devOnly?: boolean
  /**
   * Options forwarded verbatim to `hakka-browser`'s `start()`, e.g.
   * `{ overlay: 'launcher', console: true, captureBeacons: true }`.
   */
  start?: Record<string, unknown>
  /**
   * Vite only. Default `false`. When `true`, `configureServer` lazily imports
   * the optional `hakka-node` peer and registers server-side capture, so Vite
   * dev-server requests (SSR loaders, API routes) show up in the overlay
   * alongside client traffic — no manual `register()` call needed.
   * `register()` applies its own dev-only gate, so this is a no-op outside
   * dev regardless. webpack/rspack ignore this option: their dev servers
   * proxy to a separate Node process they don't own.
   */
  server?: boolean
  /**
   * CSP nonce attached to the injected `<script>` tag's `nonce` attribute, so
   * a host running a strict `script-src` (no `'unsafe-inline'`) can allow-list
   * it. Without this, the injected tag has no way to satisfy such a policy and
   * the browser silently drops it — no Hakka error, just a CSP violation in
   * the console the plugin never sees. Only meaningful when your CSP
   * header/meta tag emits this SAME value per request (a static nonce defeats
   * the point of CSP) — typically read from whatever already generates your
   * per-request nonce and passed straight through here. Omit to inject
   * without one (default): fine under `'unsafe-inline'` or no CSP at all.
   */
  nonce?: string
}

/** Marker so the injected tag is recognisable and de-duplicatable. */
export const HAKKA_INJECT_ATTR = 'data-hakka'

/** Vite only. The inline ESM module source that imports and starts the overlay. Relies on `devHtmlHook` — see the file doc above. */
export function buildInjectSnippet(start: Record<string, unknown> = {}): string {
  return `/* hakka: injected inspector overlay (dev only) */\nimport { start } from 'hakka-browser'\nstart(${JSON.stringify(start)})`
}

/** webpack/rspack only. The classic (non-module) call that starts the overlay once `window.Hakka` exists — see the file doc above. */
export function buildStartCall(start: Record<string, unknown> = {}): string {
  return `Hakka.start(${JSON.stringify(start)})`
}

/**
 * webpack/rspack only. Insert two classic `<script>` tags before `</body>`
 * (or append when there is no body): one `src`-loads the pre-built global
 * Hakka bundle at `src` (defines `window.Hakka`), one inline runs `startCall`.
 * Classic (non-module, non-async, non-defer) scripts execute synchronously in
 * source order, so the loader is guaranteed to finish — and `window.Hakka` to
 * exist — before the starter runs; nothing here needs a module resolver.
 * Skips if a Hakka tag is already present, so re-running is a no-op.
 */
export function injectExternalScriptsIntoHtml(html: string, src: string, startCall: string, nonce?: string): string {
  if (html.includes(HAKKA_INJECT_ATTR)) return html
  const nonceAttr = nonce ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : ''
  const tags =
    `<script ${HAKKA_INJECT_ATTR}="true" src="${src}"${nonceAttr}></script>\n` +
    `<script ${HAKKA_INJECT_ATTR}-start="true"${nonceAttr}>${startCall}</script>`
  return html.includes('</body>') ? html.replace('</body>', `${tags}\n</body>`) : html + tags
}
