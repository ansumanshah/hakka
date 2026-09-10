---
title: 'ADR 0010 — Completing Hakka for macOS: table stakes first, rules over the bridge, scripting behind a contract'
description: The completion plan for the desktop app, the capture boundary it preserves, and the contracts the remaining features land behind.
---

Status: Implemented (unreleased) · Date: 2026-08-21 · Extends [ADR 0008](/contributing/adr/0008-desktop-plugin-products/) · Applies [ADR 0009](/contributing/adr/0009-contracts-first-internals/)

## Status sweep 2026-08-22: implemented

Every sub-decision below is built and tested on `main`:

- **Table stakes** — body viewers, waterfall, cookies, editor depth,
  collection UX, folder runs, OAuth flows.
- **Rules over the bridge** — Rules tab (Mocks/Breakpoints/Throttle), typed
  `ControlCommand` encoding, promote-capture-to-mock (desktop action and the
  `promote_capture_to_mock` MCP twin), breakpoint pause-and-edit.
- **`ScriptRuntime`** — JavaScriptCore sandbox with wall-clock watchdog,
  conformance harness, editor tab, persisted collection field.
- **WebSocket + SSE** — sibling transports behind `RequestTransport`, frame
  console, streaming detail rendering (including LLM stream assemblers).
- **gRPC inspection** — shipped per the amendment below; sending stays
  deferred (`.claude`-tracked scope note: 3–5 weeks, needs a real HTTP/2
  client because `URLSession` exposes no trailers API).

Landed beyond the original scope: `console`/`storage` bridge frames with
desktop Logs and Storage panels ([ADR 0011](/contributing/adr/0011-additive-wire-evolution/)),
TLS/cipher/redirect-chain connection facts, a Devices sidebar, leak
detection, the CI network-baseline gate, and metric-token adoption gated by
`ui-token-check`.

Still open, all release mechanics rather than architecture: Developer ID
signing and notarization (owner-gated — the app runs but is not installable
by others), and RN/Android console/storage senders (decode tolerance shipped,
sending did not).

## Amendment 2026-08-22: gRPC is no longer deferred

Sub-decision 4 below defers gRPC past completion. **The owner has reversed
that.** gRPC is prioritised, and this section records why the original
reasoning does not survive contact with the codebase.

The deferral rested on gRPC costing "weeks of lift" for proto descriptor
loading or server reflection plus a `grpc-swift` dependency. That estimate
covers the SENDING half only. gRPC-Web and raw protobuf wire decoding
already ship across the whole SDK fleet and were not counted:
`ios/Sources/Common/BodyDecoders/GrpcWebDecoder.swift` and
`ProtobufDetectors.swift`, `android/hakka-common/.../GrpcWebDecoder.kt` and
`ProtoWireDecoder.kt`, and `packages/hakka-core/src/engine/decode/grpcWeb.ts`,
each with tests.

So the work splits, and only the second half was ever expensive:

- **Inspection** is mostly wiring. The decoders exist; the desktop app routes
  gRPC content types to a hex fallback instead of to them. The genuinely
  new work is small and specific: frame structure with the compression flag,
  schema-less protobuf field rendering that is honest about being inferred,
  and surfacing `grpc-status` from the trailers rather than the HTTP status,
  since a failed gRPC call is usually HTTP 200. That last point is the most
  confusing thing about reading gRPC in a tool built for HTTP, and it is
  where most of the value sits.
- **Sending** keeps the original cost and the original open questions. It is
  scoped separately in `.claude/strategy/grpc-sending-2026-08.md` rather
  than estimated here.

The transport seam argument in sub-decision 4 still holds; it is now the
reason sending stays cheap to add rather than the reason to postpone it.

## Context

ADR 0008 shipped the desktop app as embeddable SPM products and audited each
claimed capability against the UI. That audit found several library features
that were implemented but not reachable, and closed those gaps. This ADR
defines "complete" around Hakka's own workflow: capture across its SDK fleet,
inspect and author requests on the Mac, control rules over the bridge, and
automate the same records through stable contracts.

An inventory of the app as of 2026-08-21 (all verified in source, not from
docs): body rendering is bare monospaced text, there is no timing UI despite
`startTime`/`durationMs` being on every record, no surface sends control
frames even though the hub relays them and all three rule engines ship in
`HakkaCommon`, auth stops at a static OAuth2 access token, there is no cookie
jar, WebSocket/SSE sending, or scripting, and folder runs don't exist. Each of
those is required for a complete authoring and inspection workflow. None of
them requires changing the capture boundary.

## Options considered

**A. Make a system proxy with a CA certificate the primary capture path.**
Rejected: it reopens the exact non-goal ADR 0008 settled and abandons the
in-process SDK boundary. Stated so nobody reaches for it.

**B. Stay declarative-only and stop at capture.** Rejected because declarative
assertions and response captures cover chaining but not signing, redaction-in-
place, or computed payloads.

**C. Interleaved completion: table stakes first, then rules-over-the-bridge,
protocols, and sandboxed scripting behind contracts; gRPC explicitly deferred.
** Accepted.

## Decision

Option **C**. Four sub-decisions, each scoped:

### 1. Use stable network-debugging vocabulary

Hakka uses familiar names for Map Local, breakpoints, block lists, network
conditions, compose/replay, diff, timing charts, sessions, scripting, and MCP
tools. The capture mechanism remains distinct: no CA
certificate, no system proxy, no DNS spoofing, no external-proxy plumbing,
ever. The Rules tab exists because the engines already live in the SDKs on the
other end of the wire; that placement is the product.

### 2. Rules over the bridge is the flagship gap

The wire protocol already carries control frames byte-compatibly between the
Node hub and every SDK; the Swift hub relays them today without a sender. The
completion work is typed `ControlCommand` encoding in `DesktopCore`, a Rules
tab (Mocks / Breakpoints / Throttle sections, mirroring the RN/iOS structure),
and one direct workflow: **promote a captured response into a live mock in one
action**, plus breakpoint pause-and-edit of a real device's
in-flight traffic from the Mac. No new server capability is required; hostile-
input tests mirror the Node hub's existing contract.

### 3. Scripting lands behind a `ScriptRuntime` contract

JavaScriptCore, pre-request and post-response hooks, persisted as a versioned
collection-format field. The contract ships `@experimental` with a conformance
harness per ADR 0009 (rule of three before freeze), and the sandbox bar is
testable, not aspirational: wall-clock timeout enforced, filesystem and
network access absent, escape attempts asserted to fail, script errors
surfaced to the UI rather than swallowed. API surface stays deliberately
small (`env`, `log`, request/response mutation); no `require`, no npm, and no
unbounded dependency or I/O surface.

### 4. New send paths are transports; protocols scope to WebSocket + SSE

`RequestTransport` already isolates the runner from URLSession. WebSocket and
SSE land as sibling transports with conformance tests, streaming-aware detail
rendering, and a frame console. gRPC is deferred past completion, explicitly:
it needs proto descriptor loading or server reflection plus a dependency
decision (grpc-swift), which is weeks of lift for a protocol whose dev-loop
share doesn't justify blocking release readiness. Deferred, not ruled out;
the transport seam keeps it cheap to add later.

## Consequences

- Foundation first means the first shippable milestone is body viewers,
  waterfall, real OAuth2 flows, cookies, editor
  depth, collection UX, folder runs. Boring by design; it unblocks everything
  users touch daily.
- Public API grows by at least one contract (`ScriptRuntime`) under the
  forever-commitment rule; staging as `@experimental` until a third consumer.
- The collection file format gains fields (scripts now, rule references when
  rules become saveable); round-trip byte-identity tests extend per house
  rule.
- External product research stays outside public source and comments. Hakka's
  implementation follows its own contracts and the licences of its declared
  dependencies.

## Non-goals (restated so they stay non-goals)

CA certificates, system proxy, DNS spoofing, external proxying, pinning
bypass, cloud session sharing (ADR 0004's self-hosted posture), team
workspaces, telemetry.

## Sizing

- **Table stakes phase — M per item**, dominated by the body-viewer registry
  and the OAuth flows; nothing here needs new architecture, only discipline.
- **Rules over the bridge — S for the control encoding** (the wire shapes
  exist and are pinned by the Node hub's tests), **M for the tab and the
  promote/breakpoint UX**, which is new interaction surface.
- **WebSocket + SSE transports — M total** behind the existing
  `RequestTransport` seam; streaming detail rendering is the fiddly half.
- **`ScriptRuntime` — M for contract plus conformance harness**, S per API
  addition after; adversarial sandbox-escape testing is the long pole.
- **Release readiness — S mechanical** except signing and notarization
  credentials, which are user-owned.

No L-scale unknown remains in the completion plan. gRPC is the one deferred L,
and the transport seam is what keeps it deferrable rather than foreclosed.

## Verification plan

- Body viewers and waterfall: golden tests against pinned fixture records;
  viewer registry covered by content-type dispatch tests.
- OAuth2 flows: authorization-code+PKCE exercised against a loopback stub
  server; token persistence lands in environment secrets, asserted encrypted
  at rest where the OS provides it.
- Control frames: encode/parse tests asserted against the shapes in
  `packages/hakka-bridge/src/protocol.ts`, including malformed input; a
  round-trip smoke sends a mock rule from the desktop hub to a fixture device
  and asserts the device engine state changed.
- `ScriptRuntime`: conformance harness runs timeout, post-stop, and escape
  attempts (network reach, filesystem reach, infinite loop) against the JSC
  implementation; a deliberately broken fake proves the harness can fail.
- Transports: WebSocket/SSE transports tested against local loopback servers;
  no test touches an external host.
- Whole app: `swift build && swift test` stays green per commit; files under
  200 lines; Swift 6 strict concurrency throughout.
