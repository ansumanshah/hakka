# Storage Wire Fixtures

Pinned JSON payloads for the `storage` bridge frame kind
(`{ "type": "storage", "payload": StorageSnapshot }`) — mirrors the
precedent set by `fixtures/console/`, `fixtures/span/`, and
`fixtures/control/`: one shared file per wire shape/edge case, intended to be
read by every runtime's tests so a shape change in one runtime's decoder
fails the others' tests instead of drifting silently.

**Status:** TypeScript is wired —
`packages/hakka-bridge/src/__tests__/consoleStorageFixtures.test.ts` reads
every file here and decodes it through `parseBridgeMessage`. Swift
(`ios/Tests/HakkaTests`) and Kotlin
(`android/hakka-common/src/test/kotlin/...`) are **not** — their existing
storage tests hand-type literal values that happen to match these files
rather than reading them, so a shape change there won't yet fail loudly here.
`fixtures/control/`'s `ControlFixtures.swift`/`.kt` are the pattern to follow
when someone picks that up.

Every field matches `StorageSnapshot` in
`packages/hakka-core/src/model/types.ts` exactly: `store` (free-form name),
`timestamp` (epoch ms), `entries` (`Record<string, string>`, already
redacted upstream by the SDK — nothing here needs scrubbing by a receiver).
A `storage` frame is **snapshot-replace**: a new frame for the same `store`
replaces its prior contents wholesale, it is never a diff, so there is no
"partial update" fixture to add.

## Rules

Same as `fixtures/span/README.md`: wire transcripts, not demos. Small,
deterministic, hand-reviewable JSON. Do not reformat. Add a fixture only for
a genuinely new shape or edge case.

## Current fixtures

- `defaults-snapshot.json` — `store: "defaults"` (iOS `UserDefaults.standard`
  / the general "app preferences" store every runtime has some equivalent
  of), a few plain string values.
- `keychain-redacted-snapshot.json` — `store: "keychain-redacted"`, showing
  the convention a sender uses for secret values it still wants to surface
  as _present_ without leaking their contents: a fixed redaction marker
  string rather than omitting the key.
- `empty-snapshot.json` — `store: "cookies"` with `entries: {}`, the "store
  exists but is currently empty" edge case (e.g. the user just cleared
  cookies) — a receiver must render this as "0 entries", not treat an empty
  object as a missing/malformed snapshot.
