/**
 * hakka-node/next/client — start the browser overlay and connect it to the
 * bridge. One-line setup: `import 'hakka-node/next/client'` in Next 15.3+'s
 * `instrumentation-client.ts` (older Next: call `startHakkaClient()` from a
 * `'use client'` component's effect instead). Browser-only, dev-only, and
 * never imports the server code — see [Setup](/nextjs/overview/#setup).
 *
 * LOAD-BEARING: this file's ENTIRE observable effect is the
 * `startHakkaClient()` call at the bottom, run for its side effect on a bare
 * import — nothing exported here is meant to be consumed as a binding on
 * that path. That makes `package.json`'s `"sideEffects"` declaration
 * load-bearing: it must list `"./dist/next/client.mjs"` explicitly (scoped,
 * not `"sideEffects": false`), or a bundler that sees no binding used from
 * the import is free to tree-shake the whole import away — as happened under
 * Next 16 + Turbopack before this was scoped. See `packages/hakka-node/package.json`.
 */
export interface HakkaClientOptions {
  /** Bridge hub URL the overlay connects to. Default `ws://localhost:8989`. */
  bridgeUrl?: string
  /** Options forwarded to `hakka-browser`'s `start()`. */
  start?: Record<string, unknown>
  /** Start even in production (default false — dev-only). */
  force?: boolean
  /**
   * How long to wait for `import('hakka-browser')` to settle before warning
   * the overlay hasn't started. Default 4000ms — a backstop for failure modes
   * where the import promise never settles at all (a bundler 500ing on a
   * missing `hakka-browser`, or any other stuck-chunk-load). Set to
   * `Infinity` to disable.
   */
  settleTimeoutMs?: number
}

interface HakkaWebModule {
  start: (options?: Record<string, unknown>) => void
  connect: (url?: string) => void
}

const CLIENT_COMPONENT_DOC_ANCHOR =
  'https://github.com/ansumanshah/hakka/tree/main/packages/hakka-node#overlay-pattern-prefer-a-client-component-over-instrumentation-clientts'

// The specifier MUST be a literal: bundlers can only include hakka-browser as
// an async chunk when they see it statically — a variable specifier reaches
// the browser as an unresolvable bare `import('hakka-browser')`. Its own
// top-level function purely so tests can substitute a controlled loader.
function loadHakkaBrowser(): Promise<HakkaWebModule> {
  return import('hakka-browser') as Promise<HakkaWebModule>
}

/**
 * Start the overlay + connect to the bridge. Safe to call once on the client.
 *
 * `loadHakkaBrowser` is an internal test seam (defaults to the real
 * `loadHakkaBrowser` above) — application code should never pass it.
 */
export function startHakkaClient(
  options: HakkaClientOptions = {},
  loadHakkaBrowser_: () => Promise<HakkaWebModule> = loadHakkaBrowser,
): void {
  if (typeof window === 'undefined') return
  if (!options.force && process.env.NODE_ENV === 'production') return

  let settled = false
  const settleTimeoutMs = options.settleTimeoutMs ?? 4000
  const settleTimer =
    process.env.NODE_ENV !== 'production' && Number.isFinite(settleTimeoutMs)
      ? setTimeout(() => {
          if (settled) return
          console.warn(
            '[hakka] overlay not started — hakka-browser failed to load or is still loading; ' +
              `see ${CLIENT_COMPONENT_DOC_ANCHOR} for a pattern that avoids this.`,
          )
        }, settleTimeoutMs)
      : undefined

  void loadHakkaBrowser_()
    .then((hakka) => {
      settled = true
      clearTimeout(settleTimer)
      // hakka-browser defaults `trace` off; this entry's whole purpose is the
      // unified client+server timeline, so it defaults trace ON here
      // (same-origin-only propagation; `options.start.trace` still wins for
      // opt-out). `ignorePatterns` below drops Next's dev-machinery noise
      // (stack-frame POSTs, HMR, static chunks) — a caller's own list replaces it.
      hakka.start({
        trace: true,
        ignorePatterns: [
          '*__nextjs*',
          '*_next/static*',
          '*_next/webpack-hmr*',
          // Turbopack (the default since Next 16) polls a different HMR
          // endpoint than the webpack-era pattern above.
          '*_next/hmr*',
          '*hot-update*',
          '*telemetry.nextjs.org*',
        ],
        ...options.start,
      })
      hakka.connect(options.bridgeUrl)
    })
    .catch((e: unknown) => {
      settled = true
      clearTimeout(settleTimer)
      // hakka-browser not installed or failed to load — the overlay won't appear.
      // Surface the cause in dev so a broken peer install isn't a silent no-op.
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[hakka] overlay not started — hakka-browser failed to load:', e)
      }
    })
}

// Auto-start on bare import (`import 'hakka-node/next/client'`).
startHakkaClient()
