// Captured-record bookkeeping shared by every framework demo: print each
// NetworkRequest as it arrives — the proof this example runs without an
// inspector UI — and keep them around so a demo can check trace
// correlation for itself instead of just asserting it in prose.
//
// A `fetch()` capture emits TWICE for the same request `id` by design —
// once at headers-received time, once more once the body finishes
// downloading (hakka-core's capture/fetch.ts, "two-phase emission" —
// deliberate, so the inspector can show a request as soon as headers land
// instead of waiting for a slow/streamed body). A `node:http`/`https`
// capture (httpInterceptor.ts) does NOT do this — one call, one emission.
// This demo's servers make their outbound call with `fetch()`, so a real
// sink has to be ready for both: keep the LATEST record per id, but only
// print the first sighting so the console proof reads as one line per
// request instead of a confusing repeat.
const captured = new Map() // id -> latest NetworkRequest
const printed = new Set() // ids already logged

/** hakka-node's `sink` option: called once or twice per captured record. */
export function printRecord(label, req) {
  captured.set(req.id, req)
  if (printed.has(req.id)) return // the body-complete follow-up for a request already logged below
  printed.add(req.id)
  const duration = req.duration != null ? `${Math.round(req.duration)}ms` : 'n/a'
  const status = req.status ?? 'n/a'
  const trace = req.correlationId ? `  correlationId=${req.correlationId}` : ''
  console.log(`  [${label}] ${req.method} ${req.url} -> ${status} (${duration})${trace}`)
}

/** The captured record whose correlationId matches `traceId`, if any. */
export function findByTrace(traceId) {
  for (const req of captured.values()) {
    if (req.correlationId === traceId) return req
  }
  return undefined
}

export function section(title) {
  console.log(`\n${title}`)
  console.log('-'.repeat(title.length))
}
