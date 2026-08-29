---
title: 'ADR 0014 — Simulator-injection capture: what it can and cannot see'
description: The exact reach of `hakka sim attach` — an iOS Simulator app captured by injecting Hakka's SDK before its main() runs, with no certificate and no proxy, and the structural reasons (a separate WebKit process, code signing, no Android path) it stops where it does.
---

Status: Implemented (spike) · Date: 2026-08-29

## Context

`hakka sim attach` is a working capability, not a proposal. `ios/SimInject`
(a standalone SPM package building a dylib) and
`packages/hakka-cli/src/sim.ts` landed 2026-08-22, and both prove Hakka's
existing capture path, `HakkaInterceptor` plus `HakkaBridgeClient`, working
inside an iOS Simulator app this repo never built or linked against.

Its scope, failure modes, and the testing behind it were written up in
`.claude/strategy/simulator-capture-2026-08.md`. That path is gitignored:
every file under `.claude/strategy/` stays local and was never committed, so
that writeup was never visible to anyone reading the repository itself, only
to whoever had the working tree that produced it. Four source comments still
point at it as the source of truth for this capability: `ios/SimInject/Package.swift`,
`SimInjectBootstrap.swift`, `SimInjectBootstrapTests.swift`, and
`packages/hakka-cli/src/sim.ts`, four links into a file nobody else can open.

That matters because this capability sits right next to a line ADR 0008 and
ADR 0010 already drew with care: Hakka's desktop app is explicit that it
needs no CA certificate and no system proxy, and states plainly that the
trade for that is an app it did not build stays invisible to it. `hakka sim
attach` reaches an app this repo did not build, from a Simulator, and still
needs no certificate, which on the surface sounds like it reopens that
non-goal. Whether it does or not should be a committed, reviewable answer,
not a fact that lived only in an ignored file and a handful of dangling
comments.

## Options considered

**A. A system-wide proxy with a CA certificate, scoped to the Simulator.**
Rejected. This is the exact mechanism ADR 0008 and ADR 0010 ruled out for
the desktop app, and running inside the Simulator does not change the trust
cost: a certificate still has to be generated and trusted, and traffic
still has to be routed through a process outside the app being inspected.

**B. Process-launch injection: `xcrun simctl launch` with the
`SIMCTL_CHILD_DYLD_INSERT_LIBRARIES` environment prefix, running the SDK's
own capture path inside the target process before its `main()` executes.**
Accepted. `simctl` strips the `SIMCTL_CHILD_` prefix and hands the child
process a plain `DYLD_INSERT_LIBRARIES=<dylib>`; dyld loads that dylib and
runs its `__attribute__((constructor))` function before the host app's own
entry point, which is where `HakkaSimInjectBootstrap.start()` registers
`HakkaURLProtocol` and installs the `URLSessionConfiguration` swizzle, the
same two steps `HakkaInterceptor.start()` performs when a host app embeds
the SDK normally.

**C. Require every Simulator app under test to add the Hakka SDK to its own
build.** This is the status quo the capability exists to relax, not a real
alternative: the situations this is for, a third-party app, a teammate's
build, an old build that is not easy to rebuild, are exactly the ones where
adding a dependency and rebuilding is the obstacle, not the fix.

## Decision

Option B, unchanged from the 2026-08-22 spike. `hakka sim attach <bundle-id>`
resolves a booted Simulator device, terminates and relaunches the target
bundle with the dylib and bridge URL injected, and streams captured requests
to the bridge hub exactly as an embedded integration would.

### What it can see

- Any app already installed on a booted Simulator, including one this repo
  did not build. Verified against MobileSafari and Maps.app, neither of
  them a Hakka SDK consumer: injection succeeded and in-process traffic was
  captured for both, because injection happens at the OS process-launch
  layer, not by linking against the target's source.
- Everything the SDK's own in-process path already captures, unmodified:
  `URLSession` traffic on `.default`/`.ephemeral`-configured sessions (the
  interceptor's existing method swizzle) and native
  `URLSessionWebSocketTask` frames when `captureNativeWebSocket` is on.
- All of that with no CA certificate, no trust-store write, and no
  system-wide proxy configured at any point. The dylib runs as code inside
  the one process `simctl launch` starts; it does not intercept that
  process's traffic from outside it, it is that process, in the same sense
  an embedded `HakkaInterceptor` is. That is why this does not reopen ADR
  0008's and ADR 0010's non-goal: that non-goal is about becoming a
  standing interception point for every app on the machine. This reaches
  one named Simulator process, only for as long as a developer explicitly
  runs `hakka sim attach`, and stops being active the moment that process
  exits.

### What it cannot see

- WebKit's own page-load traffic: Safari's navigation requests, a
  `WKWebView`'s page loads. WebKit runs its networking in a separate
  `com.apple.WebKit.Networking` XPC service, a distinct process from the
  app `simctl launch` starts. `DYLD_INSERT_LIBRARIES` only reaches the one
  process being launched, never a sibling XPC service the OS spins up on
  its behalf, so the interceptor never loads there. Verified directly:
  MobileSafari's own page traffic did not appear while its in-process
  `URLSession` calls did. This is a process boundary, not a gap in the
  injection code, and closing it would mean injecting into WebKit's XPC
  service itself, a different and considerably riskier target.
- `URLSession.shared` traffic, though this is not specific to sim-attach.
  It is a standing characteristic of `HakkaInterceptor`, documented on
  `SimInjectBootstrap.swift`: `.shared`'s configuration does not route
  through the swizzled `.default`/`.ephemeral` getters the way an
  explicitly constructed session does, so `.shared` traffic is invisible
  to any Hakka integration, injected or embedded. Worth restating here
  because a developer's first instinct testing sim-attach against an
  unfamiliar app is to suspect the injection, when the real cause predates
  it.
- Physical devices. This is deliberate, not a limitation to lift: a
  code-signed, hardened-runtime process on a real device ignores an
  injected `DYLD_INSERT_LIBRARIES` the same way it refuses any other
  unsigned code, and Simulator binaries do not carry that protection,
  which is what makes this technique usable there at all. `sim.ts` and
  `SimInjectBootstrap.swift` both already state this as intentional.
- Android. No equivalent exists: no dyld analogue for process injection on
  a standard app process, no `hakka android attach` command, nothing under
  `android/` that does this. A gap in coverage, stated plainly so it does
  not get assumed away.

## Consequences

- The boundary stated above is now versioned and reviewable, the first
  committed record of it. A later change to `HakkaInterceptor`'s capture
  path, such as `.shared` becoming interceptable or a workable path into
  WebKit's networking process being found, should update this ADR rather
  than a private file nobody else can read.
- Three source comments still cite the missing
  `.claude/strategy/simulator-capture-2026-08.md`: `ios/SimInject/Package.swift`,
  `SimInjectBootstrap.swift`, and `SimInjectBootstrapTests.swift`. They sit
  outside this ADR's file ownership; a follow-up should point all three at
  this ADR instead. `packages/hakka-cli/src/sim.ts`'s own header comment
  was fixed alongside this ADR.
- `hakka sim attach` stays a spike: `sim.ts`'s own usage text says it does
  not ship a prebuilt dylib. This ADR records its scope ahead of any
  decision to promote it further, a README entry, a prebuilt dylib, CI
  coverage, so that promotion can build on a settled boundary instead of
  re-deriving one.
- `docs/desktop/overview.md`'s "Why not a proxy" section now cross-references
  this ADR, so a reader of the desktop app's own no-proxy claim also learns
  that Simulator injection is a second, narrower capture path with the same
  no-certificate property, not an exception to it.

## Verification plan

- The empirical basis is the 2026-08-22 spike itself: capture verified
  against MobileSafari and Maps.app, neither built by this repo, with
  in-process `URLSession(configuration: .default)` traffic captured for
  both and MobileSafari's own page-load traffic absent, confirming the
  WebKit process boundary claimed above.
- `SimInjectBootstrapTests.swift` covers the one piece of
  `HakkaSimInjectBootstrap` testable without a live Simulator process:
  `resolveBridgeURL()`'s environment-variable resolution. Injection and
  capture themselves need a live Simulator process to observe, as that
  suite's own doc comment already says.
- Re-verifying the boundary claims here means repeating the manual pass
  against a WebKit-hosting app and a call site that uses
  `URLSession.shared`. No automated Simulator-injection test runs in CI
  today, a gap worth its own follow-up rather than something this ADR can
  close by writing it down.
