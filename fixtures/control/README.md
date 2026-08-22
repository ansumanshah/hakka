# Control-Channel Wire Fixtures

Pinned JSON transcripts for the `breakpoint.paused` / `breakpoint.resume` /
`breakpoint.abort` / `mock.add` control-command kinds — mirrors the
precedent set by `fixtures/sse/`: one shared file per wire shape, read by
every runtime's tests (TypeScript in `packages/hakka-core`, Swift in
`ios/Tests/HakkaTests` and `apps/hakka/Tests/CoreTests`, Kotlin in
`android/hakka-network`) so a shape change in one runtime's parser or
encoder fails the others' tests instead of drifting silently.

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
- `mock-add-failure.json` — a `mock.add` rule with `failure: { code }`
  (transport-error mock, see `MockFailureCode` in
  `packages/hakka-core/src/engine/MockEngine.ts`): the request fails as a
  network error instead of any response, on every runtime.
- `mock-add-skip-stop.json` — a `mock.add` rule with `skipCount`/`stopAfter`
  set together: serve the real response for the first `skipCount` matches,
  then apply for the next `stopAfter` matches, then pass through as real
  traffic forever. See `MockRule.skipCount`/`.stopAfter` in `MockEngine.ts`
  for the full semantics (counter lives in device-side engine state, reset
  on relaunch).
- `mock-add-header-values.json` — a `mock.add` rule whose response carries
  two `Set-Cookie` values through the additive `headerValues` field (see
  `MockResponse.headerValues` in `MockEngine.ts`): `headers` still has one
  representative value (old decoders keep working), `headerValues` has the
  full ordered list. RFC 6265 §3 forbids folding multiple Set-Cookie values
  into one comma-joined field, which is why this needed a wire shape change
  rather than reusing `headers` alone.
