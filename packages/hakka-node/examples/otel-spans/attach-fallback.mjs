/**
 * attach-fallback.mjs: the OTHER attach path. `enableTraceSpans()`'s
 * SDK-1.x `attach()` fallback tries to find a post-registration
 * `addSpanProcessor` method on whatever's registered as the global
 * `TracerProvider`. This example's own `@opentelemetry/sdk-trace-node` (2.x,
 * see package.json) has no such method: its `TracerProvider` base class
 * takes `spanProcessors` ONLY in its constructor (see constructor-time.mjs).
 * So THIS demo reproduces the exact failure mode the root README's "Next
 * Request Insights" section warns about (paraphrased from `README.md`):
 *
 *   hakka-node also tries a post-registration addSpanProcessor duck-type as
 *   an SDK-1.x fallback, but it silently no-ops on 2.x, with no error to
 *   point at why spans never show up. Always pass hakkaSpanProcessor()
 *   explicitly for wiring that's guaranteed to work on either SDK generation.
 *
 * Nothing here is a bug in hakka-node: `attach()` is explicitly documented
 * as best-effort, fail-open compatibility with an older SDK generation (see
 * spanProcessor.ts's module doc). The point of running it is to make that
 * failure mode real and repeatable instead of a claim in a comment: this
 * demo's own assertion is that ZERO spans arrive, and it fails loudly if
 * that stops being true, which would mean either this package's
 * `@opentelemetry/sdk-trace-node` pin regained `addSpanProcessor`, or
 * hakka-node's fallback logic changed.
 */
import http from 'node:http'

import { trace } from '@opentelemetry/api'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { enableTraceSpans } from 'hakka-node'

import { check, section, summary } from './shared/printSpan.mjs'

// No spanProcessors passed here: this is the OLD SDK-1.x pattern, register
// the provider first, then hope something finds addSpanProcessor on it
// afterward. Compare with constructor-time.mjs, which passes
// hakkaSpanProcessor() to the constructor instead.
const provider = new NodeTracerProvider()
provider.register()

const received = []
const handle = enableTraceSpans((span) => received.push(span), 'server')

// attach()'s dynamic `import('@opentelemetry/api')` + duck-type probe is
// fire-and-forget (see spanProcessor.ts's enableTraceSpans doc), give it a
// macrotask to settle before sending any request, the same way this
// package's own test suite's `flush()` helper does.
await new Promise((resolve) => setTimeout(resolve, 0))

const tracer = trace.getTracer('otel-spans-demo')

const server = http.createServer((req, res) => {
  tracer.startActiveSpan('BaseServer.handleRequest', (root) => {
    root.setAttribute('next.span_type', 'BaseServer.handleRequest')
    root.setAttribute('next.rsc', 'false')
    root.end()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

section("attach-fallback  (no hakkaSpanProcessor() at construction time: attach()'s SDK-1.x path only)")
const res = await fetch(`http://127.0.0.1:${port}/`)
await res.text()
console.log(`  client -> GET http://127.0.0.1:${port}/  -> ${res.status}`)

check(
  "0 spans delivered: attach()'s post-registration addSpanProcessor probe found nothing on this SDK-2.x provider, exactly as documented",
  received.length === 0,
  `got ${received.length}`,
)
if (received.length === 0) {
  console.log('  Always wire hakkaSpanProcessor() at construction time instead (see constructor-time.mjs).')
}

handle.teardown()
await new Promise((resolve) => server.close(resolve))
process.exitCode = summary() ? 0 : 1
