# Trace Wire Fixtures

Pinned JSON payloads for `FrameworkSpan` (and the `NetworkRequest` a trace
roots on) — mirrors the precedent set by `fixtures/control/` and
`fixtures/sse/`: one shared file per wire shape/edge case. Today's only
reader is Swift (`apps/hakka/Tests/CoreTests/TraceFixtures.swift`,
`apps/hakka/Sources/Core/Trace/TraceTree.swift` / `TraceStore.swift` under
test), but every field matches `FrameworkSpan` in
`packages/hakka-core/src/model/types.ts` exactly, so a TypeScript test can
adopt these files verbatim the moment one needs file-based span fixtures —
today's TS span tests (`traceTree.test.ts`, `traceSummary.test.ts`,
`buildEvidenceBundle.test.ts`) all construct spans inline with helper
functions rather than from files, so there was no existing file-fixture
convention to join; this directory establishes it for the next runtime that
needs one, same as `fixtures/control/` did for the control channel.

## Rules

Same as `fixtures/control/README.md`: wire transcripts, not demos. Small,
deterministic, hand-reviewable JSON. Do not reformat. Add a fixture only for
a genuinely new shape or edge case.

## Current fixtures

All five files share one trace (`traceId`/`correlationId` `"trace-1"`), so a
test can combine any subset and get a coherent scenario:

- `root-request.json` — the client hop that originates the trace: a
  `NetworkRequest` with `correlationId: "trace-1"`, `runtime: "client"`,
  `startTime: 1732000000000`, `duration: 420`.
- `server-root-span.json` — the server's root span for the same trace
  (`parentId: null`), starting 50ms after the client request per normal
  network latency — the "happy path" causal ordering.
- `server-child-span.json` — a nested span (`parentId` = the root span's
  `id`), `verbosity: "verbose"`, so tests can assert primary/verbose
  filtering and depth computation together.
- `orphan-span.json` — `parentId` references a span id that never arrives
  in the trace. Exercises "a span whose parent never arrives": depth
  resolution must not throw or infinite-loop, and must fall back to depth 0
  (see `traceTree.ts`'s `computeSpanDepths` doc and its Swift mirror).
- `negative-skew-span.json` — a root span (`parentId: null`) whose
  `startTime` is 500ms _before_ `root-request.json`'s `startTime`: the
  server's clock reads earlier than the client's, so naively this span would
  render as starting before the request that caused it. Exercises the
  clock-skew clamp in `TraceTree.assemble` (Swift) — the corrected render
  position must never precede the causing request's start, even though the
  raw timestamp does.
