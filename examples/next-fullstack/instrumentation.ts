/**
 * Next.js server-boot hook. One line starts Hakka's server-side capture (Server
 * Components, Route Handlers, Server Actions) and embeds the bridge hub in-process
 * — so there is no separate `hakka-bridge` process to run. Dev-only.
 *
 * `undiciTiming` enriches server-side `fetch` records with DNS/TCP/TLS phase
 * timing from undici's diagnostics channels (best-effort — enrichment is
 * skipped when two identical in-flight requests make correlation ambiguous).
 * Without it those phases show as "—" for server fetches; `http`/`https`
 * module calls always carry them.
 *
 * `registerOTel()` (from `@vercel/otel`) MUST run BEFORE `hakkaRegister()` —
 * this is the ordering requirement Next Request Insights depends on.
 * `hakka-node`'s `traceSpans` option (on by default in dev — see
 * `hakka-node/next`'s `startServerCapture`) reads whatever `hakkaSpanProcessor()`
 * instance is passed into `spanProcessors` below; if none was passed and no
 * SDK-1.x provider is discoverable either, it fails open silently (no span
 * data, no error) rather than throwing. This file is the reference
 * integration other users copy — get this wrong and Next's own request-tree
 * spans (Server Components, Route Handlers, Server Actions) simply never show
 * up in the overlay, with no error to point at why.
 *
 * `HAKKA_PROD_CAPTURE=1` (production only — `instrumentation.prod.ts`) additionally
 * starts ADR 0002's cohort capture (`hakka-node/prod`), dynamically imported behind
 * the same `NEXT_RUNTIME === 'nodejs'` gate as `hakkaSpanProcessor` below so it never
 * reaches an Edge bundle. Unset (the default), this file's dev-path behavior is
 * unchanged — see `packages/hakka-node/README.md#production-capture-for-a-debug-cohort-hakka-nodeprod`
 * and `examples/next-fullstack/README.md`.
 *
 * `spanProcessors: [hakkaSpanProcessor()]` — NOT `[]`. `@opentelemetry/sdk-trace-base`
 * 2.x (what `@vercel/otel` 2.x uses) removed `TracerProvider.addSpanProcessor`,
 * so processors can only be attached at construction time now; hakka-node has
 * no way to reach in after the fact and attach its own. Passing
 * `hakkaSpanProcessor()` here — a plain object hakka-node hands you, with no
 * exporter attached — is what makes span data flow at all on SDK-2.x. It also
 * means the array is never empty even though there's still no OTLP exporter
 * configured: the default exporter POSTs to localhost:4318/v1/traces, and with
 * no collector running, every request would add a failed `POST /v1/traces` row
 * to the very inspector you're reading. Shipping telemetry for real? Add your
 * own exporter/processor alongside `hakkaSpanProcessor()` in this array —
 * Hakka rides alongside whatever else you configure.
 *
 * The `hakkaSpanProcessor` import below is DYNAMIC and gated on
 * `NEXT_RUNTIME === 'nodejs'`, not a plain top-level `import` the way
 * `hakkaRegister` is — `hakkaSpanProcessor` needs `hakka-node`'s Node-only
 * internals (trace propagation's `node:http`/`node:https` patch, the
 * embedded bridge's `node:os`/`node:crypto` use), and a static import of it
 * here would drag that whole graph into Next's edge-instrumentation compile
 * too (confirmed empirically: Turbopack resolves it even though it's
 * reached from a runtime-only branch), producing "Node.js module ... not
 * supported in the Edge Runtime" build warnings. `hakka-node/next`'s own
 * `register()` avoids exactly this by doing the same dynamic-import-behind-
 * `NEXT_RUNTIME` dance internally — this file just has to do it too for the
 * one extra Node-only symbol it needs directly.
 */
import { registerOTel } from '@vercel/otel'
import { register as hakkaRegister } from 'hakka-node/next'

export async function register(): Promise<void> {
  const spanProcessors =
    process.env.NEXT_RUNTIME === 'nodejs' ? [(await import('hakka-node')).hakkaSpanProcessor()] : []
  registerOTel({ serviceName: 'hakka-next-fullstack-example', spanProcessors })
  await hakkaRegister({ undiciTiming: true, traceSpans: true })

  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NODE_ENV === 'production' &&
    process.env.HAKKA_PROD_CAPTURE === '1'
  ) {
    const { getProdCapture } = await import('./instrumentation.prod')
    getProdCapture()
  }
}
