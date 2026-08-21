# Control-Channel Wire Fixtures

Pinned JSON transcripts for the `breakpoint.paused` / `breakpoint.resume` /
`breakpoint.abort` control-command kinds — mirrors the precedent set by
`fixtures/sse/`: one shared file per wire shape, read by every runtime's
tests (TypeScript in `packages/hakka-core`, Swift in `ios/Tests/HakkaTests`
and `apps/hakka/Tests/CoreTests`, Kotlin in `android/hakka-network`) so a
shape change in one runtime's parser or encoder fails the others' tests
instead of drifting silently.

See `packages/hakka-core/src/engine/control.ts` for the canonical shape
definitions.

## Rules

- Fixture files are wire transcripts, not demos. Keep them small,
  deterministic, and hand-reviewable.
- Do not reformat, pretty-print, or rewrap the JSON; one object per line,
  as it would actually be sent.
- Every runtime's test parses the fixture through its own
  `parseControlCommand` and asserts the resulting typed command — not a
  byte comparison — since JSON serializers differ in escaping/whitespace
  conventions runtime to runtime. Byte-exact framing is still checked
  independently (Swift's `ControlCommandEncoder` pins exact encode bytes in
  its own tests).
- Add a new fixture only for a genuinely new wire shape or edge case (e.g.
  a request-phase vs. response-phase resume carry different edit shapes),
  not a cosmetic variant of an existing one.

## Current fixtures

- `breakpoint-paused.json` — a response-phase pause notification (device ->
  host): `ruleId` present, `response` present (response-phase only),
  `request` present (always).
- `breakpoint-resume-request.json` — resuming a request-phase pause (host ->
  device) with `requestEdits` only.
- `breakpoint-resume-response.json` — resuming a response-phase pause (host
  -> device) with `responseEdits` only.
- `breakpoint-abort.json` — aborting a pause (host -> device), the minimal
  shape: `kind` + `pauseId` only.
