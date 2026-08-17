/**
 * Side-effect-only shim: forces `ws` to skip its optional native
 * `bufferutil`/`utf-8-validate` addons and use its pure-JS fallback.
 *
 * Needed when this package (or a consumer like `hakka-node`) loads inside a
 * bundler context that doesn't fully externalize `ws` — e.g. Next.js's
 * instrumentation webpack layer — and stubs the missing native addon to `{}`
 * instead of letting `require` throw. `ws`'s try/catch fallback detection
 * then never engages, and `ws.send()` throws. `WS_NO_BUFFER_UTIL` skips that
 * require entirely; no perf cost at dev-inspector volumes.
 *
 * Must be imported before the first `import 'ws'` in this package's module
 * graph — ESM module bodies run in declaration order, so `import './wsCompat'`
 * as the first line of any module that imports `ws` is sufficient.
 */
if (typeof process !== 'undefined' && process.env) {
  process.env.WS_NO_BUFFER_UTIL ??= '1'
}
