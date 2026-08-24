---
title: Sessions & analytics
description: Spec card — per-launch capture sessions, the .hakka session file, the .hakka-repro reproduce bundle, and the in-app store-size view.
---

## What it does

A "session" is simply the set of requests captured since the app process started — every
platform's capture store is an in-memory ring buffer with no default persistence, so it resets on
every cold start (**per-launch sessions**). `hakka-core` exposes an opt-in `StorageAdapter`
interface for a host that wants a session to survive a restart, but no shipped platform wires one
by default. Beyond the live in-memory session, `hakka-core` can serialize the current request set
to a portable `.hakka` JSON file (**session share/export**) or a `.hakka-repro` bundle (requests +
derived mock rules, for reproducing a bug without the original backend), and RN/web ship UI to
save, share, and re-import them. Every inspector also has a **store-size view** — a live count of
captured requests plus their total body-byte footprint, so a developer can see the ring buffer's
actual memory/size cost.

## Public API

```ts
import { Hakka } from 'hakka-core'
import type { StorageAdapter } from 'hakka-core'
import { serializeSession, deserializeSession, SESSION_SCHEMA_VERSION } from 'hakka-core' // .hakka
import { buildReproBundle, REPRO_BUNDLE_SCHEMA_VERSION } from 'hakka-core' // .hakka-repro
import type { ReproBundle, ReproBundleMeta, ReproMockRule, BuildReproBundleOptions } from 'hakka-core'
```

```ts
Hakka.setStorageAdapter(adapter: StorageAdapter | null): void
// StorageAdapter: save(records) on every ingest, load() once at Hakka.start(), clear()

serializeSession(requests, meta?)   // '.hakka' JSON string — see Export card for the wire format
buildReproBundle(requests, options?) // { requests, mocks } — see Export card for the wire format
```

RN (`hakka-core` imported directly by `SettingsPanel.tsx`/`SettingsViewModel.ts` — not
re-exported from `hakka-react-native`'s own public surface):

```ts
import { serializeSession, deserializeSession, Hakka } from 'hakka-core'

// Export: serializeSession(logs, { device: getDefaultDeviceInfo() }), then Share.share({ message: json })
// Import: deserializeSession(pastedJson) -> Hakka.ingest() each request
```

Web (`packages/hakka-browser/src/ui/Inspector.tsx` — internal to the overlay's Session menu):

```ts
serializeSession(reqs, { exportedFrom: 'hakka-browser' }) // Save session -> downloadBlob(..., 'hakka')
deserializeSession(text) // Load session -> merges into the store
buildReproBundle(reqs, { meta: { exportedFrom: 'hakka-browser' } }) // Repro bundle -> downloadBlob(..., 'hakka-repro')
```

Web (`packages/hakka-browser/src/ui/SettingsTab.tsx` — store-size view):

```ts
await store().getSnapshot() // NetworkRequest[]; count + sum(requestBodySize + responseBodySize)
```

## Config keys + defaults

Not part of `HakkaConfig` — sessions/analytics are called on-demand, not configured at startup.

| Function/adapter       | Option/behavior   | Default                                              |
| ---------------------- | ----------------- | ---------------------------------------------------- |
| `serializeSession`     | schema version    | `SESSION_SCHEMA_VERSION = 1`                         |
| `buildReproBundle`     | schema version    | `REPRO_BUNDLE_SCHEMA_VERSION = 1`                    |
| `StorageAdapter`       | wired by default? | none — every shipped platform is in-memory only      |
| Web store-size refresh | trigger           | on Settings-tab mount, and a manual "Refresh" button |

## Platform matrix

SPEC §3's Sessions/Analytics bullet has no row in §5 today — these rows are new, chosen not to
collide with any existing §5 row name:

| Capability                    | RN  | iOS | Android | Web | Mac app |
| ----------------------------- | --- | --- | ------- | --- | ------- |
| Per-launch sessions           | ●   | ●   | ●       | ●   | ●       |
| Session share/export (.hakka) | ●   | —   | —       | ●   | ●       |
| Repro bundle (.hakka-repro)   | —   | —   | —       | ●   | —       |
| Store-size view               | ●   | ●   | ●       | ●   | ◐       |

- **Per-launch sessions** — verified structurally: `LogStore` on iOS (`ios/Sources/Common/LogStore.swift`)
  and Android (`android/hakka-network/.../LogStore.kt`) are plain in-memory ring buffers with no
  file/`UserDefaults`/`SharedPreferences`-backed persistence; `hakka-core`'s engine is the same
  (ring buffer + optional unwired `StorageAdapter`). Every platform starts a session empty on
  cold launch.
- **Session share/export** — `.hakka` is a `hakka-core` JS function, so it's only reachable from
  JS hosts. RN wires it into `SettingsPanel.tsx`'s Session section (export via the share sheet,
  import by pasting JSON into a modal). Web wires it into `Inspector.tsx`'s Session menu (download
  a `.hakka` file, or load one via a hidden file input). iOS and Android have no Swift/Kotlin port
  of `serializeSession`/`deserializeSession` and no session-file UI.
- **Repro bundle** — web-only. `Inspector.tsx`'s Session menu has a dedicated "Repro bundle"
  action (`buildReproBundle` → download a `.hakka-repro` file). No RN, iOS, or Android code
  references `buildReproBundle` or `.hakka-repro` at all — RN has the export UI for `.hakka` but
  not for repro bundles.
- **Store-size view** — every platform's Stats/Settings surface shows a byte total for captured
  bodies: web's Settings tab ("N requests · X of bodies", `refreshStoreSize()` in
  `SettingsTab.tsx`), RN's Stats hero ("N requests / X moved", `totalDataTransferred` in
  `monitorSummary.ts`), iOS's `DashboardView` ("Payload" card, `Fmt.formatBytes(totalPayloadBytes)`),
  and Android's `StatsTabController` ("Response Size" Total/Avg cards, `buildSizeStats`). The
  underlying number differs slightly by platform (web/iOS sum request+response body bytes stored
  right now; RN/Android sum response bytes transferred) but all four answer the same question:
  how big is what's currently held.

## Wire format

`.hakka` and `.hakka-repro` are documented in full (schema, field-by-field shape) on the
[Export](/spec/export/) card — this card only tracks who can produce/consume them and when a
session boundary starts. Summary: `.hakka` is `{ hakkaSession: 1, exportedAt?, meta?, requests }`;
`.hakka-repro` is `{ version: 1, exportedAt?, meta?, requests, mocks }` where `mocks` is derived
from `requests` via `generateMockRules`, not authored separately.

`StorageAdapter` has no wire format — it's an in-process interface
(`save(records)` / `load()` / `clear()`), not a serialized message; what a custom implementation
does with the records (file, SQLite, remote) is entirely up to the host app.

## Test anchors

- `packages/hakka-core/src/session/__tests__/serialize.test.ts` — `.hakka` round-trip, tolerant parse, error cases.
- `packages/hakka-core/src/repro/__tests__/buildReproBundle.test.ts` — `.hakka-repro` construction.
- `packages/hakka-core/src/engine/__tests__/persistence.test.ts` — `StorageAdapter` save/load/clear wiring
  (coalesced writes, `clearLogs()` cancels a pending write).
- `packages/hakka-react-native/src/ui/viewModels/__tests__/SettingsViewModel.test.ts` —
  `importSession` success/failure and modal state.
- `packages/hakka-browser/src/ui/__tests__/Inspector.uxFeatures.test.tsx` (`describe('Session save/load')`) — the
  Session menu's Save/Load actions, session-file import merging into the store, and the Repro
  bundle download action.

## Limits & non-goals

- No platform ships cross-launch persistence by default. `StorageAdapter` is a real, tested
  extension point in `hakka-core`, but every shipped web/RN integration in this repo leaves it
  unset — a host app must implement and register its own adapter to survive a restart.
- iOS and Android have no session file support at all (no `.hakka`/`.hakka-repro` read or write) —
  their only export surface is the per-platform HAR/OTel/Postman/cURL formats covered by the
  [Export](/spec/export/) card.
- The repro bundle's regression-test file (`hakka-core/test`'s `generateTestFile`) is not part of this
  capability — it's stitched on by the MCP `generate_repro` tool on top of a bundle this layer
  produces, per the Export card.
- "Store-size view" is a live snapshot, not a historical record — no platform tracks size over
  time or across sessions; refresh is manual (a button) or tied to mounting the settings/stats
  surface.
