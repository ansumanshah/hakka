import { randomUUID } from 'node:crypto'

// hakka-node's trace-correlation header — see "Trace correlation" in
// packages/hakka-node/README.md. Not exported as a constant from
// hakka-node's public API (the root export re-exports TRACEPARENT_HEADER
// but not this one), so this is the literal value the README documents.
const HAKKA_TRACE_HEADER = 'x-hakka-trace'

/**
 * Simulate an already-traced caller: send `x-hakka-trace` on the request the
 * way an upstream service (or a browser running hakka-browser) already
 * would. Runs in this same process, so this call is itself captured too
 * (fetch is patched process-wide) — with no correlationId of its own, since
 * nothing set one before this call was made. That's expected: this is the
 * hop the trace *originates* on. See the framework demo files for the hop
 * that joins it.
 */
export async function callWithTrace(url, traceId = randomUUID()) {
  console.log(`  client -> GET ${url}  (${HAKKA_TRACE_HEADER}: ${traceId})`)
  const res = await fetch(url, { headers: { [HAKKA_TRACE_HEADER]: traceId } })
  await res.text()
  return traceId
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
