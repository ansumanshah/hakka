/**
 * hakka-node/next — server-side network capture for Next.js.
 *
 * Instruments `fetch` + Node `http`/`https` in the server runtime and streams
 * captures into the Hakka inspector, so server and client API calls appear in one
 * UI. In-process instrumentation (no proxy, no CA cert), wired through Next's
 * `instrumentation.ts` `register()` hook.
 *
 * This entry is EDGE-SAFE: Next compiles `instrumentation.ts` for every runtime,
 * so nothing here may import `node:*` statically. `process.env.NEXT_RUNTIME` is
 * inlined at build time, letting Next dead-code-eliminate the dynamic import
 * below out of Edge bundles. The full Node API (startServerCapture,
 * interceptors, trace, bridge client) lives in `hakka-node/next/server`.
 *
 * `hakkaSpanProcessor()` deliberately does NOT live here even though it's
 * commonly wired right next to `register()` in `instrumentation.ts` — it
 * transitively needs `../trace`'s `node:crypto`/`node:http`/`node:https`
 * imports, which would break the edge-safety guarantee above. Import it from
 * the main `hakka-node` entry (or `hakka-node/next/server`) instead — see
 * `examples/next-fullstack/instrumentation.ts`.
 */
// Type-only import — erased at compile time, so this entry stays edge-safe.
import type { ServerCaptureOptions } from './serverCapture'

export async function register(options?: ServerCaptureOptions): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Next's "instrument" webpack layer bundles `ws` (a transitive dep of the
    // bridge client, reached below) instead of externalizing it, and stubs its
    // optional `bufferutil`/`utf-8-validate` native addons to `{}` rather than
    // letting `require` throw. `ws`'s try/catch fallback detection then never
    // engages, and every send throws — silently swallowed by the bridge
    // client's queue/retry logic, so zero frames ever reach the hub with no
    // visible error. `WS_NO_BUFFER_UTIL` skips that require entirely (no perf
    // cost at dev-inspector volumes); must be set before the dynamic import
    // below, ahead of `ws`'s own module eval.
    process.env.WS_NO_BUFFER_UTIL ??= '1'
    const server = await import('./server')
    await server.register(options)
  }
}

export type { ServerCaptureOptions, ServerCapture } from './serverCapture'
export type { NetworkRequest, RequestRuntime } from 'hakka-core'

export const HAKKA_NODE_NEXT_VERSION = '0.1.0'
