---
title: 'ADR 0008 — Hakka for macOS as SPM products, not an app'
description: A native Swift desktop app that is API client and inspector in one, shipped as embeddable SPM products so other Swift apps can host the same surfaces.
---

Status: Implemented (unreleased) · Date: 2026-08-17

## Context

Hakka's inspector ships inside someone else's app: an overlay in RN/web, a
sheet on iOS, a bottom sheet on Android. That model has a ceiling. A guest
overlay on a phone cannot give you a multi-pane response diff, a saved
request collection, or a place to keep a request around after the session
that produced it ends.

Two separate needs converged on the same answer:

1. **The inspector wants a desktop surface.** `hakka-bridge` already streams
   captured traffic off a device over WebSocket, and `hakka mcp` already
   consumes it. The missing piece is a human-facing desktop client — today
   that role is played by a Node hub plus whatever UI the user has open.
2. **Captured traffic wants to become saved requests.** The most common
   thing a developer does after seeing an interesting request in an inspector
   is re-run it with a tweak. Every API client (Bruno, Yaak, Postman,
   Insomnia) can save and re-run requests; none of them can see your app's
   live traffic without a system proxy and a CA certificate. Hakka already
   has the traffic, in-process, with no certificate.

The earlier plan for this was a separate Tauri app under a different name.
That was reversed (2026-08-16): a scaffold was built and reverted the same
day. Tauri means a second runtime, a second UI stack, and a second
implementation of views that already exist in Swift — for an app whose
entire value is agreeing exactly with the SDK's record contract.

## Options considered

**A. Tauri/Electron desktop app.** Rejected. Reimplements the inspector UI in
a third stack, ships a browser runtime to render views that already exist as
SwiftUI, and puts a serialization boundary between the app and the record
contract it must match byte-for-byte.

**B. A standalone Swift app with its own copy of the inspector views.**
Rejected for the same reason ADR 0003 rejected forking the six web
components: two copies of the same view drift the first time a bug is fixed
on one side.

**C. A Swift package of embeddable products, with a thin app host.**
Accepted. The desktop functionality ships as SPM _products_
(`HakkaDesktopCore`, `HakkaDesktopServer`) that depend on the existing
`HakkaCommon`/`HakkaUI` products by path. The `.app` is an executable target
that wires them together and owns nothing but window management.

## Decision

Option **C**, at `apps/hakka` in this monorepo.

- **`HakkaDesktopCore`** — collections, environments, the request runner,
  importers/exporters, traffic store. No UI, no server, no window. Pure
  model plus logic, so it is testable headlessly and embeddable anywhere.
- **`HakkaDesktopServer`** — the bridge hub as a Swift actor (Network
  framework `NWListener`), speaking the exact wire protocol in
  `packages/hakka-bridge/src/protocol.ts`. This makes the desktop app a
  drop-in replacement for the Node hub for desktop users: one app to run
  instead of a hub process plus a viewer.
- **`HakkaDesktop`** (executable) — the SwiftUI app shell.

Three consequences follow from the product split, and they are the point:

- **Noodle and Ramen can embed it.** Both are existing Swift apps that
  already want a traffic pane; they add a package dependency rather than
  shelling out to a separate app.
- **The record contract cannot drift.** The desktop app consumes
  `HakkaCommon.NetworkRequest` directly — the same type the iOS SDK captures
  into and the same shape the bridge serializes. A request that arrives from
  a device and a request the desktop app sends itself are the same type,
  which is what makes "promote a captured request into a collection" a
  conversion rather than an integration.
- **`ios/Sources` stays canonical.** The desktop package depends on it by
  path and never copies from it. `apps/hakka` adds only what desktop needs.

### Feature scope

Parity targets, stated plainly so scope creep is visible. "Built" means
implemented, reviewed, and covered by tests — not that a signed release
exists:

| Area                                                                        | Comparable to     | Status                |
| --------------------------------------------------------------------------- | ----------------- | --------------------- |
| Plain-text, git-diffable collections (one file per request)                 | Bruno             | built                 |
| Environments + `{{variable}}` interpolation, secrets outside the collection | Bruno, Yaak       | built                 |
| Request runner, declarative assertions, response captures                   | Bruno, Yaak       | built                 |
| Import from cURL / Postman / OpenAPI / HAR; code generation                 | all of them       | built                 |
| Live capture, traffic list, response diff, session export                   | Proxyman          | built                 |
| Bridge hub + Bonjour discovery                                              | Hakka's own       | built                 |
| System-wide HTTPS proxy with a CA certificate                               | Proxyman, Charles | **explicit non-goal** |

The last row is the deliberate difference. Proxyman sees every app's traffic
because you install its certificate; Hakka sees _your_ app's traffic because
the SDK is in it. That is a smaller scope and a much smaller trust ask, and
it is the entire reason Hakka needs no certificate.

## Consequences

- A second Swift package in the repo, built by `swift build` from
  `apps/hakka`, with its own test target (Swift Testing).
- The macOS platform floor is 14.0, matching the existing package.
- `HakkaUI` is iOS-first; views that are UIKit-gated are not reusable on
  macOS as-is. The app uses what is portable and builds native equivalents
  for the rest rather than weakening the iOS views with platform branches.
- The Node `hakka-bridge` package stays — it is still the right answer for
  web/RN users who want a hub without a Mac app.
- Distribution (signing, notarization, appcast) is not addressed here; the
  package builds and runs locally first.

## Verification plan

- `swift build` and `swift test` from `apps/hakka` in CI alongside the
  existing iOS legs.
- Round-trip tests for the collection format: a model that serializes
  byte-identically twice, and `load(save(x)) == x` across every body/auth
  case.
- Wire-protocol tests for the hub asserted against the shapes in
  `packages/hakka-bridge/src/protocol.ts`, including hostile input
  (malformed JSON, wrong shapes, oversized frames) — the Node hub's own
  robustness contract.
- The runner's assertion and capture logic tested against a stubbed
  `URLSession`; no test touches the network.
