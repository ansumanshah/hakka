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
 * `./serverCapture`'s own `register()` also implements a `runtime: 'edge'`
 * branch, but it's unreachable from here: reaching it means importing
 * `./server` (and everything it re-exports), which is the Node-only module
 * this comment just said can never be imported on Edge. On `NEXT_RUNTIME ===
 * 'edge'` this module instead dynamically imports `./edgeCapture` — a
 * separate, genuinely Edge-safe module whose only `hakka-core` dependency is
 * `enableFetchInterceptor` — so real fetch capture runs on Edge too, not just
 * on `nodejs`. There is no embedded bridge on Edge (see `edgeCapture.ts`'s
 * module doc for why), so captures only reach a caller-supplied `options.sink`;
 * without one, capture still runs but every record is discarded, which is why
 * this warns once in development when `sink` is missing.
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
    return
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    // Mirrors `./serverCapture`'s own `register()` production gate — that
    // function isn't reachable from here (see the module doc above), so the
    // same "no-op in production unless runtime/force is explicit" rule is
    // re-applied locally instead of silently behaving differently on Edge.
    if (process.env.NODE_ENV === 'production' && options?.runtime == null && !options?.force) return
    const { startEdgeCapture } = await import('./edgeCapture')
    startEdgeCapture({
      maxBodySize: options?.maxBodySize,
      redactHeaders: options?.redactHeaders,
      ignorePatterns: options?.ignorePatterns,
      sink: options?.sink,
    })
    // See `edgeCapture.ts`'s module doc: there's no bridge on Edge, so a
    // caller who didn't pass `sink` gets real capture with nowhere for
    // records to go. Surfaced in dev only, matching `next/client.ts`'s
    // pattern for other silent-gap warnings.
    if (!options?.sink && process.env.NODE_ENV !== 'production') {
      console.warn(
        '[hakka] register() is capturing fetch on the Edge runtime, but no `options.sink` was configured — ' +
          'every record is captured then discarded (there is no embedded bridge on Edge). Pass `sink` to receive them.',
      )
    }
  }
}

export type { ServerCaptureOptions, ServerCapture } from './serverCapture'
export type { NetworkRequest, RequestRuntime } from 'hakka-core'

export const HAKKA_NODE_NEXT_VERSION = '0.1.0'
