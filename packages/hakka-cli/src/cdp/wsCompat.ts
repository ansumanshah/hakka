/**
 * Side-effect shim: makes `ws` skip its optional native `bufferutil`/
 * `utf-8-validate` addons and use its pure-JS fallback.
 *
 * Some bundler-based Node consumers (e.g. Next's instrumentation webpack
 * layer) stub a missing native addon to `{}` instead of letting `require`
 * throw, so `ws`'s try/catch fallback never engages and `ws.send()` throws —
 * silently swallowed by the bridge client's queue/retry logic, so frames
 * never reach the hub with no visible error. Must be imported before the
 * first `import 'ws'` in this package's module graph (ESM runs declarations
 * in order). Same shim as `hakka-node`'s and `hakka-bridge`'s `wsCompat.ts`.
 */
if (typeof process !== 'undefined' && process.env) {
  process.env.WS_NO_BUFFER_UTIL ??= '1'
}
