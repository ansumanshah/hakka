---
title: 'ADR 0002 — Production capture for a debug cohort'
description: A capture-only hakka-node/prod entry that lets a named cohort of users be inspected in production without shipping the dev control channel.
---

Status: Implemented · Date: 2026-07-10

## Context

Hakka is a dev-loop tool: `register()` no-ops unless `NODE_ENV === 'development'`
(or `force`), capture is denylist-redacted, and the browser overlay reaches the
server's capture over `ws://localhost:8989`. ADR 0001 listed "sampling,
production tracing" as explicit non-goals for 2.0.

The new requirement flips that: run capture in production for a **small,
named set of users**, so a bug that only reproduces on real traffic (a specific
account, a device, a region) can be inspected after the fact. This is a common
pattern — `eruda`/`vConsole` ship to prod behind a query param, session-replay
tools (Sentry Replay, LogRocket) sample cohorts — so there is precedent and user
appetite. But the current architecture makes four assumptions that only hold in
dev, and each is a correctness or security problem in prod.

The four load-bearing dev assumptions:

1. **Everyone is captured.** The `fetch`/`http` patches are process-global; there
   is no per-user gate. In prod that means capturing users who never opted in.
2. **The overlay can reach the capture.** In prod the user's browser cannot
   reach the server's `localhost:8989`, and exposing that hub publicly is unsafe.
3. **Capture is safe to leave wide-open.** Denylist redaction + the mock /
   rewrite / breakpoint control channel are conveniences in dev and attack
   surface in prod (an unauthenticated peer can rewrite live responses —
   `bridge/src/server.ts` has no auth or `Origin` check; `parseBridgeMessage`
   does not validate control payloads by design).
4. **Big bodies are free.** `capture/fetch.ts` reads the _entire_ response body
   via `clone().text()` in the background regardless of `maxBodySize` (the cap
   only gates storage) — an unbounded transient allocation, fine against dev
   traffic, not against prod volume.

## Options considered

**A. `force: true` and ship as-is.**
Zero new code. Rejected outright: no per-user gate (assumption 1), no transport
that works cross-network (2), the control channel stays exploitable (3), and the
unbounded read (4) runs against real load. This is the option to explicitly rule
out so nobody reaches for it.

**B. A separate prod build target with capture stripped down to a ring buffer.**
A distinct entry (`hakka-node/prod`) that installs _only_ the capture half —
no bridge client, no control-frame receiver, no embed hub — writes records into
a bounded in-memory ring buffer, and exposes them through a same-origin authed
route the operator pulls on demand. Cohort gating rides on the trace ALS context
that already exists (`trace.ts`): middleware sets a signed cookie for allowlisted
users, the ALS store carries a `debug` flag, and the capture sink drops records
from unflagged contexts. Capture becomes allowlist-by-URL, not denylist-redact.

**C. Delegate prod entirely to an APM/session-replay integration.**
Don't capture in prod at all; document `traceparent` interop (already built) and
tell users to correlate in their existing RUM + APM stack. Rejected as the
_primary_ answer: it abandons the differentiator (full request/response bodies
in one client+server timeline, no APM SDK) precisely where it is most valuable.
Kept as a complementary export path, not a replacement.

## Decision

Option **B**, with C's `traceparent` export left available. Rationale:

- **Cohort gating is already built — it's the trace context.** The per-request
  ALS identity in `trace.ts` is the natural sampling primitive; the sink in
  `hakka-node/serverCapture.ts` already receives every record and can drop
  unflagged ones. Non-cohort requests then pay only the synchronous prologue
  (microseconds), never body capture or serialization.
- **The dangerous half must be compiled out, not merely disabled.** Mock /
  rewrite / breakpoints are request-_editing_. A prod build that can only read is
  a smaller, auditable surface — a config flag that leaves the code present is
  not good enough for a security boundary.
- **Allowlist beats denylist for prod bodies.** Bodies carry tokens and PII;
  "capture URLs I named" fails safe, "capture everything then redact known-bad
  headers" fails open.
- **Pull, don't push.** Cohort users won't watch an overlay; the operator wants
  the last N requests for a user later. A ring buffer + on-demand authed
  retrieval matches how the industry actually debugs cohorts and sidesteps the
  cross-network transport problem entirely.

## Consequences / scope

- **New prod entry** (`hakka-node/prod`, edge-safe re-export like the dev one):
  capture-only, no bridge client, no embedded hub, control-frame receiver absent
  from the bundle.
- **Ring buffer + retrieval route.** Bounded in-memory buffer (default small,
  operator-tunable) plus a same-origin route (`/__hakka/pull`) behind the app's
  own auth. No new open port.
- **Cohort gate.** Middleware helper that sets a signed cookie for an allowlist;
  ALS store carries the `debug` flag; sink drops unflagged records. Documented as
  the _only_ supported way to turn prod capture on.
- **Allowlist capture.** `captureUrls?: string[]` (glob) — in prod, capture is
  opt-in per URL pattern; redaction stays as defense-in-depth, not the boundary.
- **Bounded body read (prerequisite, also fixes dev).** Replace the background
  `clone().text()` with a size-gated reader that stops after `maxBodySize`
  bytes. This is the one unbounded cost in the pipeline and blocks any prod path.
- **Bridge hardening (only if a live transport is ever added).** Shared-token
  handshake + `Origin` allowlist on the WSS upgrade; not needed by the pull model
  but required before any push-to-browser prod transport.
- **Non-goals (unchanged from 0001):** span-timing semantics beyond the record
  contract, becoming an APM, retention/PII policy engines. This ADR adds a
  cohort debug capability, not an observability product.

## Verification plan

- Unit: cohort gate drops unflagged records; allowlist capture ignores
  non-matching URLs; the bounded reader caps allocation at `maxBodySize` for a
  synthetic 20 MB body (assert peak string length, not just stored size).
- Integration: extend the smoke-roundtrip pattern — an allowlisted request and a
  non-allowlisted request through the prod entry → assert only the first lands in
  the ring buffer and is returned by `/__hakka/pull`, and that the control-frame
  symbols are absent from the built prod bundle (grep the output).
- Security: assert the prod build exposes no unauthenticated port and that
  `/__hakka/pull` 401s without the operator token.
