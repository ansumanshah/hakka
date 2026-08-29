/**
 * constructor-time.mjs: the SDK-2.x-safe way to wire hakka-node into an
 * already-registered OpenTelemetry TracerProvider. Build `hakkaSpanProcessor()`
 * and pass it to the provider's OWN constructor, the same way the root
 * README's Next.js section does (`registerOTel({ spanProcessors: [hakkaSpanProcessor()] })`).
 *
 * This example installs `@opentelemetry/sdk-trace-node` 2.x (see
 * package.json), the current OTel SDK generation and the one real
 * `@vercel/otel` installs today. Its `TracerProvider` (from
 * `@opentelemetry/sdk-trace`, which `sdk-trace-node`/`sdk-trace-base` both
 * build on) takes `spanProcessors` ONLY in its constructor: there is no
 * `addSpanProcessor` method on the class at all. `attach-fallback.mjs` in
 * this same directory proves what happens if you skip this step and rely on
 * `enableTraceSpans()`'s old post-registration fallback instead: nothing.
 */
import http from 'node:http'

import { trace } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { currentServerTraceId, enableTraceSpans, hakkaSpanProcessor } from 'hakka-node'

import { check, printSpan, section, summary } from './shared/printSpan.mjs'

// 1. Build the processor. It doesn't need enableTraceSpans() to exist yet:
//    onStart/onEnd read the LIVE registration each time they fire, not at
//    construction time (see spanProcessor.ts's `registration` doc). Real
//    usage constructs it this same way, inside
//    `registerOTel({ spanProcessors: [hakkaSpanProcessor()] })`, before the
//    app's own `hakkaRegister()`/`enableTraceSpans()` call ever runs.
const processor = hakkaSpanProcessor()

// 2. Wire it in at CONSTRUCTION time: the only reliable attach point on
//    this SDK generation.
const provider = new NodeTracerProvider({ spanProcessors: [processor] })
provider.register() // registers as the global @opentelemetry/api TracerProvider

// 3. Register a sink AFTER the provider exists, proving step 1's claim: the
//    processor forwards to whatever enableTraceSpans() registers LATER, not
//    to whatever (if anything) was live when hakkaSpanProcessor() was called.
const received = []
const handle = enableTraceSpans((span) => received.push(span), 'server')

const tracer = trace.getTracer('otel-spans-demo')

const server = http.createServer((req, res) => {
  tracer.startActiveSpan('BaseServer.handleRequest', (root) => {
    // onStart already ran (span construction calls it synchronously) and
    // adopted this span's OTel trace id as the ALS correlationId: the pure
    // SSR/no-incoming-header case adoptOtelTraceId exists for (see trace.ts).
    // No x-hakka-trace header was sent on this request, so this is the ONLY
    // way this request has a Hakka trace id at all.
    const adoptedTraceId = currentServerTraceId()

    tracer.startActiveSpan('AppRouteRouteHandlers.runHandler', (routeHandler) => {
      routeHandler.setAttribute('next.span_type', 'AppRouteRouteHandlers.runHandler')
      routeHandler.end()
    })

    // The SAME operation hakka-core's own fetch interceptor would capture as
    // a NetworkRequest, tagged the way Next tags its own outbound-fetch span.
    // handleSpanEnd's APP_RENDER_FETCH_SPAN_TYPE check drops this one
    // rather than double-report it. Watch for it missing from the "spans
    // delivered to sink" list below.
    tracer.startActiveSpan('AppRender.fetch', (fetchSpan) => {
      fetchSpan.setAttribute('next.span_type', 'AppRender.fetch')
      fetchSpan.end()
    })

    tracer.startActiveSpan('ResolveMetadata.generateMetadata', (verboseSpan) => {
      // No next.span_type attribute at all -> falls outside
      // PRIMARY_SPAN_TYPES -> verbosity 'verbose' (still delivered, unlike
      // the AppRender.fetch span above: verbose just means "hidden by
      // default in the inspector", not dropped).
      verboseSpan.end()
    })

    root.setAttribute('next.span_type', 'BaseServer.handleRequest')
    root.setAttribute('next.rsc', 'false')
    root.end()

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ adoptedTraceId }))
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

section('constructor-time  (hakkaSpanProcessor() wired via spanProcessors: [...] at construction)')
const res = await fetch(`http://127.0.0.1:${port}/`)
const body = await res.json()
console.log(`  client -> GET http://127.0.0.1:${port}/  -> ${res.status}`)

// onEnd fires synchronously inside span.end(), so `received` is already
// complete by the time the handler's response is sent: no wait needed.
for (const span of received) printSpan(span)

check(
  'exactly 3 spans delivered to the sink (root + 2 children; AppRender.fetch dropped)',
  received.length === 3,
  `got ${received.length}`,
)
check(
  "AppRender.fetch was NOT delivered (deduped against hakka-core's own fetch capture)",
  !received.some((s) => s.name === 'AppRender.fetch'),
)

const root = received.find((s) => s.parentId === null)
check(
  'root span classified verbosity=primary (BaseServer.handleRequest is in PRIMARY_SPAN_TYPES)',
  root?.verbosity === 'primary',
)
check(
  'root span classified requestKind=route-handler (next.rsc=false + a route-handler child was seen)',
  root?.requestKind === 'route-handler',
  root?.requestKind,
)

const routeHandlerSpan = received.find((s) => s.name === 'AppRouteRouteHandlers.runHandler')
check('AppRouteRouteHandlers.runHandler classified verbosity=primary', routeHandlerSpan?.verbosity === 'primary')
check('AppRouteRouteHandlers.runHandler is a CHILD of the root span', routeHandlerSpan?.parentId === root?.id)

const verboseSpan = received.find((s) => s.name === 'ResolveMetadata.generateMetadata')
check(
  'ResolveMetadata.generateMetadata classified verbosity=verbose (no next.span_type attr)',
  verboseSpan?.verbosity === 'verbose',
)

check(
  "hakka's own trace correlation adopted the OTel-native trace id (no x-hakka-trace header was sent)",
  body.adoptedTraceId === root?.traceId,
  `adoptedTraceId=${body.adoptedTraceId}  root.traceId=${root?.traceId}`,
)

handle.teardown()
await new Promise((resolve) => server.close(resolve))
process.exitCode = summary() ? 0 : 1
