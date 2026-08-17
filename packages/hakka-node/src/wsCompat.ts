/**
 * Side-effect-only shim: forces `ws` to skip its optional native
 * `bufferutil`/`utf-8-validate` addons and use its pure-JS fallback.
 *
 * Needed when a bundler-based Node consumer (Next's instrumentation webpack
 * layer, other framework build layers) stubs a missing native addon to `{}`
 * instead of letting `require` throw. `ws`'s try/catch fallback detection
 * then never engages, and `ws.send()` throws — silently swallowed by the
 * bridge client's queue/retry logic, so zero frames ever reach the hub with
 * no visible error. `WS_NO_BUFFER_UTIL` skips that require entirely; no perf
 * cost at dev-inspector volumes.
 *
 * Any entry point importing `./bridgeClient` gets this fix as long as it's
 * imported before the first `import 'ws'` in this package's module graph
 * (ESM module bodies run in declaration order).
 */
if (typeof process !== 'undefined' && process.env) {
  process.env.WS_NO_BUFFER_UTIL ??= '1'
}
