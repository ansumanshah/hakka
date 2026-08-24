/**
 * Shared, bundler-agnostic injection logic for the Hakka build-tool plugins.
 *
 * Every bundler adapter (Vite, webpack, …) reuses this: the overlay is started
 * by injecting a tiny module script that imports and calls `hakka-browser`'s
 * `start()`. Keeping the snippet + HTML insertion here means each bundler hook
 * stays a thin adapter and the behaviour is identical across tools.
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

/** The module source that imports and starts the overlay. `hakka-browser` must be resolvable in the app. */
export function buildInjectSnippet(start: Record<string, unknown> = {}): string {
  return `/* hakka: injected inspector overlay (dev only) */\nimport { start } from 'hakka-browser'\nstart(${JSON.stringify(start)})`
}

/**
 * Insert the overlay `<script>` before `</body>` (or append it when there is no
 * body). Skips if a Hakka tag is already present, so re-running is a no-op.
 * `nonce`, when given, is attached as-is — see `HakkaPluginOptions.nonce`.
 */
export function injectIntoHtml(html: string, snippet: string, nonce?: string): string {
  if (html.includes(HAKKA_INJECT_ATTR)) return html
  const nonceAttr = nonce ? ` nonce="${nonce.replace(/"/g, '&quot;')}"` : ''
  const tag = `<script type="module" ${HAKKA_INJECT_ATTR}${nonceAttr}>${snippet}</script>`
  return html.includes('</body>') ? html.replace('</body>', `${tag}\n</body>`) : html + tag
}
