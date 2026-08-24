---
title: 'ADR 0013 — BridgeHub per-subscription broadcast streams'
description: Why BridgeHub's six stored AsyncStream channels died permanently on the first window close, and why the fix is a fresh per-subscription stream fanned out from a continuation registry rather than resetting or shielding the stored stream.
---

Status: Implemented · Date: 2026-08-24

## Context

`BridgeHub` exposed six channels — `requests`, `hostControls`, `spans`,
`consoleEntries`, `storageSnapshots`, `deviceEvents` — as stored
`nonisolated let` properties, each a single `AsyncStream` created once in
`init()`. `TrafficModel.start()`'s doc comment is explicit that this is
meant to be driven by a SwiftUI `.task` at the app root, and that SwiftUI
cancels a scene's `.task` when its window closes (`AppDelegate.swift`'s own
doc comment says the same). `start()` already anticipated a window
reopening and calling it again: a `defer { isRunning = false }` resets the
guard so a later `start()` isn't permanently blocked.

That defer fixed the guard, not the bug. `AsyncStream.Iterator.next()`
suspends its calling task until a value is yielded or the continuation
finishes; cancelling that task while it's suspended there does not just
abandon the iterator — it finishes the stream's *storage*, which is shared
by every iterator ever drawn from that same `AsyncStream` value. `requests`,
`spans`, etc. are each one `AsyncStream` value for the hub's entire
lifetime. So the first window close finished all six channels for good: a
later `start()` re-entered past the `isRunning` guard, spun up a fresh task
group, and subscribed to `hub.requests`/`hub.spans`/etc. again — but those
were already-finished streams. Each consumer's `for await` loop returned
immediately with zero elements. `isRunning` correctly ticked `true` and
right back to `false` (the task group completed instantly, since every
member finished immediately), often too fast for a poller to ever observe
`true` — a reopened window's inspector looked alive and captured nothing,
silently, forever.

Proof: the fixer's strengthened `TrafficModelRestartTests.swift` drives the
full cycle — `start()`, a real loopback client connects and is captured,
cancel the driving task (simulating a window close), `start()` again, and a
*second* real loopback client connects. Run against the pre-fix `BridgeHub`,
it reliably failed both `isRunning` ever ticking `true` for the second run
and the second client's request ever reaching `TrafficModel.requests`. Run
against the fix below, it passes.

## Options considered

**A. Per-subscription broadcast streams.** Replace each stored `AsyncStream`
with a `subscribeX()` method that returns a FRESH stream on every call,
backed by its own continuation, registered in a per-channel dictionary on
the actor. `ingest`/`addPeer`/`removePeer` fan a value out to every live
continuation on the relevant channel instead of yielding to one stored
continuation. Each continuation's `onTermination` deregisters only itself.
**Accepted.**

**B. Explicit `reset()`.** Keep the stored-stream shape, but give
`BridgeHub` a method that replaces the six `AsyncStream`/continuation pairs
with fresh ones, called by `TrafficModel.start()` before re-subscribing.
Rejected: it is racy against in-flight producers. `BridgeConnection`'s own
consumer task calls `hub.ingest` from a peer that may already be connected
before a reopened window's `start()` runs `reset()` — any frame ingested
between the old streams finishing (window close) and `reset()` completing
(next window's `start()`) yields into continuations that are about to be
discarded, and is lost with no way to detect the loss. It also does not
generalize: a *second* concurrent consumer of the same channel (not
speculative — `hub.spans` and `TrafficModel.consumeRequests` are both
plausible independent long-lived consumers once a feature needs one) would
still only ever get one, because `reset()` still assumes exactly one
subscriber lifetime tied to exactly one hub lifetime.

**C. Cancellation-shielded `next()`.** Wrap each consumer's stream iteration
so cancellation cannot reach the suspended `next()` call — e.g.
`withTaskCancellationHandler` doing nothing, or looping via
`Task.detached`/`withUnsafeCurrentTask` tricks to keep drawing from the
stream even after the driving task is cancelled. Rejected on two counts:
first, it does not actually solve the problem, it moves it — the consumer
task now never responds to cancellation at all, so `TrafficModel.start()`'s
task group would never complete when a window closes, and `isRunning` would
never reset, reintroducing the exact defect the existing `defer` fix
already closed. Second, and more fundamally, it fights the deliberate
scene-lifetime design documented on `start()` and `AppDelegate.swift`: a
closed window's capture consumers are SUPPOSED to stop running. Shielding
`next()` from cancellation says the opposite.

## Decision

`BridgeHub` keeps `ingest`/`addPeer`/`removePeer`/`broadcast`'s existing
signatures and behavior for relay. Each of the six channels becomes a pair:

- A per-channel dictionary of subscription id -> `AsyncStream<T>.Continuation`,
  stored directly on the actor (`BridgeHub.swift` — an extension cannot add
  stored properties).
- A `subscribeX() -> AsyncStream<X>` method (`BridgeHub+Subscriptions.swift`)
  that generates a `UUID`, creates a fresh stream via
  `AsyncStream<X>.makeStream()`, registers the continuation under that id,
  and installs an `onTermination` that removes just that one entry —
  `[weak self]` to avoid the continuation (owned by the hub) holding a
  strong closure back to the hub, and a `Task { await self?.unsubscribeX(id) }`
  hop because `onTermination` can fire off the actor and must not touch
  actor-isolated state directly.

`ingest`, `addPeer`, and `removePeer` fan a value out with a plain
`for continuation in xSubscribers.values { continuation.yield(value) }` —
still zero `await` points inside `ingest`, so one call still runs to
completion without another queued call interleaving mid-relay, same as
before.

Every consumer in `apps/hakka` (`TrafficModel.swift`'s four consumers,
`TrafficModel+Devices.swift`'s `consumeDeviceEvents`, `LogsModel.swift`,
`StorageModel.swift`) moved from `for await x in hub.x` to
`for await x in await hub.subscribeX()`. `Tests/CoreTests/ServerTests.swift`
and `Tests/CoreTests/BridgeSocketTests.swift` moved the same way, with one
behavioral consequence tests had to account for: a fresh per-subscription
stream only sees values yielded *after* the subscription exists, unlike the
old stored stream, whose buffer held a value regardless of whether anyone
was actively awaiting `next()` at yield time. Every test that used to
`ingest` (or send over a socket) before subscribing now subscribes first;
several helper functions changed from taking a `BridgeServer`/re-deriving
`server.hub.x` on every call to taking an already-subscribed
`AsyncStream<T>` once per test, reused across sequential (non-concurrent)
draws — which still works, because multiple iterators drawn from the SAME
`AsyncStream` value share its buffered storage; only re-subscribing (a
fresh `AsyncStream` value) starts empty.

`BridgeServer.hub` stays an immutable `let`; nothing about `BridgeServer`'s
own start/stop lifecycle changed.

## Consequences

- A closed window's cancelled subscription no longer affects any other
  subscription on the same channel, present or future. A later `start()`
  subscribes fresh and receives every frame ingested after that point,
  which is the whole fix.
- Multiple concurrent consumers of one channel are now a supported shape,
  not an accident of nobody having tried it yet — each gets its own
  stream and its own buffer.
- Every `hub.x` call site became `await hub.subscribeX()` — one more actor
  hop per subscription. Subscriptions happen once per `start()` call (a
  window open), not per frame, so this is not a hot-path cost.
- Test helpers that transiently re-subscribed per poll (`BridgeSocketTests`'s
  `nextCapturedRequest` and siblings) had to be restructured to subscribe
  once, up front, per test — a stricter but more honest pattern that
  matches how every production consumer actually behaves (subscribe once,
  consume for a lifetime), rather than the old accidental convenience of a
  stream that stayed populated between polls whether or not anyone was
  subscribed.
- `RuleStore.changes` and `PauseStore.changes` (`apps/hakka/Sources/Core/Rules`)
  are structurally the same stored-single-consumer-stream shape and are
  consumed from the same cancelled-on-window-close `.task` in
  `HakkaApp.swift`. They were not in scope for this ADR — nothing in the
  investigation that produced this fix touched them — but they carry the
  same latent defect and are the natural next candidate if a restart
  regression is ever reported against Rules or Pauses.

## Verification plan

- `Tests/AppTests/TrafficModelRestartTests.swift`:
  `restartingAfterCancellationResumesCaptureForANewClient` — the strong,
  end-to-end regression proof described above (start, real client, cancel,
  restart, second real client, both captured). Verified to fail against the
  pre-fix `BridgeHub` and pass against this one. The existing
  `cancellingStartResetsIsRunningSoALaterStartIsNotAPermanentNoOp` stays as
  the narrower, faster-diagnosing companion.
- `Tests/CoreTests/ServerTests.swift`'s `BridgeHubTests` — every
  `subscribeX()` channel still surfaces a decoded value from `ingest`, now
  subscribing before ingesting.
- `Tests/CoreTests/BridgeSocketTests.swift` — the same coverage over a real
  loopback socket, including the multi-client and token-gating tests that
  drain one subscription sequentially across several sends.
- `swift build && swift test` — full suite green (693 tests, up from 692;
  the one addition is the restart regression test above).
