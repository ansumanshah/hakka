# Console Wire Fixtures

Pinned JSON payloads for the `console` bridge frame kind
(`{ "type": "console", "payload": LogEntry[] }`) — mirrors the precedent set
by `fixtures/span/` and `fixtures/control/`: one shared file per wire
shape/edge case, intended to be read by every runtime's tests so a shape
change in one runtime's decoder fails the others' tests instead of drifting
silently.

**Status:** TypeScript is wired —
`packages/hakka-bridge/src/__tests__/consoleStorageFixtures.test.ts` reads
every file here and decodes it through `parseBridgeMessage`. Swift
(`ios/Tests/HakkaTests`) and Kotlin
(`android/hakka-common/src/test/kotlin/...`) are **not** — their existing
console tests hand-type literal values that happen to match these files
rather than reading them, so a shape change there won't yet fail loudly here.
`fixtures/control/`'s `ControlFixtures.swift`/`.kt` are the pattern to follow
when someone picks that up.

Every field matches `LogEntry`/`LogLevel` in
`packages/hakka-core/src/log/types.ts` exactly — this is the SDK's existing
Logs-panel model reused verbatim for the wire, not a new shape. A `console`
frame's `payload` is always an array (see `BridgeConsoleMessage`'s doc
comment in `packages/hakka-bridge/src/protocol.ts`), even for a single
entry — `log-entry-minimal.json`/`log-entry-full.json` are bare `LogEntry`
objects (the array element shape); `log-batch.json` is the actual
frame-payload shape, an array of two.

## Rules

Same as `fixtures/span/README.md`: wire transcripts, not demos. Small,
deterministic, hand-reviewable JSON. Do not reformat. Add a fixture only for
a genuinely new shape or edge case.

## Current fixtures

- `log-entry-minimal.json` — the required fields only: `id`, `timestamp`,
  `level`, `message`. No `category`/`metadata`.
- `log-entry-full.json` — every optional field populated: `category` and a
  `metadata` bag (already redaction-processed upstream, per `LogEntry`'s
  contract — nothing here needs scrubbing by a receiver).
- `log-batch.json` — the frame-payload shape itself: an array of two
  entries, exercising the "small batch" case a client coalesces from a
  burst of log calls into one frame.
