---
title: 'ADR 0010 — Completing Hakka for macOS: table stakes first, rules over the bridge, scripting behind a contract'
description: The completion plan for the desktop app — what we copy from Proxyman/Bruno/Yaak, what we refuse to copy, and the contracts the remaining features land behind.
---

Status: Proposed · Date: 2026-08-21 · Extends [ADR 0008](/contributing/adr/0008-desktop-plugin-products/) · Applies [ADR 0009](/contributing/adr/0009-contracts-first-internals/)

## Context

ADR 0008 shipped the desktop app as embeddable SPM products with an honest
parity table against Bruno, Yaak, and Proxyman. That audit also found the
table briefly meant less than it said (library built, UI unwired), and closed
the gap. This ADR covers the next question: what does "complete" mean from
here, given the 2026 competitive field?

The field moved. Proxyman 6.x spent the year on agent surfaces (MCP rule
management, scripting knowledge bases) and Chart View timing; Bruno V4
shipped WebSocket multi-message requests and YAML collections; Yaak shipped
OAuth2 in an external browser, gRPC maturity, and an agent CLI skill; and two
new open-source native-Swift Proxyman clones appeared in 2026 alone (Rockxy,
FRTMProxy). All of them share one architecture: capture through a system
proxy and a CA certificate.

Hakka's desktop app is the only one in this field that sees an app's traffic
with no certificate, because the SDK is already inside that app — on iOS,
Android, RN, web, and Node, not just macOS. Every competitor would have to
rebuild five platform SDKs and a wire protocol to reach that position. We
would have to rebuild nothing to reach their table stakes except the features
themselves. The 2026 open-source field splits cleanly: Rockxy is a native
Swift/SwiftNIO proxy competing on our terms of packaging but not our capture
model, while FRTMProxy is a SwiftUI front end over mitmproxy's Python engine.

An inventory of the app as of 2026-08-21 (all verified in source, not from
docs): body rendering is bare monospaced text, there is no timing UI despite
`startTime`/`durationMs` being on every record, no surface sends control
frames even though the hub relays them and all three rule engines ship in
`HakkaCommon`, auth stops at a static OAuth2 access token, there is no cookie
jar, WebSocket/SSE sending, or scripting, and folder runs don't exist. Each of
those is table stakes somewhere in the competitor set. None of them requires
touching a proxy.

## Options considered

**A. Match Proxyman feature-for-feature, including becoming a system proxy
with a CA certificate.** Rejected: it reopens the exact non-goal ADR 0008
settled, puts us in a cert-installation arms race against two funded teams
and mitmproxy, and abandons the differentiator mid-race. Stated so nobody
reaches for it.

**B. Stay declarative-only and differentiate purely on capture.** Rejected by
usage reality: every API client's users eventually hit the scripting wall;
Bruno, Yaak, and Proxyman each ship a scripting story for a reason. Declarative
assertions and response captures cover chaining but not signing, redaction-in-
place, or computed payloads.

**C. Interleaved completion: table stakes first, then rules-over-the-bridge,
protocols, and sandboxed scripting behind contracts; gRPC explicitly deferred.
** Accepted.

## Decision

Option **C**. Four sub-decisions, each scoped:

### 1. Copy the vocabulary, never the mechanics

Every debugging-tool concept in the competitor set is fair game — Map Local,
breakpoints, block lists, network conditions, compose/replay, diff, timing
charts, sessions, scripting, MCP tools. The capture mechanism is not: no CA
certificate, no system proxy, no DNS spoofing, no external-proxy plumbing,
ever. The Rules tab exists because the engines already live in the SDKs on the
other end of the wire; that placement is the product.

### 2. Rules over the bridge is the flagship gap

The wire protocol already carries control frames byte-compatibly between the
Node hub and every SDK; the Swift hub relays them today without a sender. The
completion work is typed `ControlCommand` encoding in `DesktopCore`, a Rules
tab (Mocks / Breakpoints / Throttle sections, mirroring the RN/iOS structure),
and one motion no proxy tool can offer: **promote a captured response into a
live mock in one action**, plus breakpoint pause-and-edit of a real device's
in-flight traffic from the Mac. No new server capability is required; hostile-
input tests mirror the Node hub's existing contract.

### 3. Scripting lands behind a `ScriptRuntime` contract

JavaScriptCore, pre-request and post-response hooks, persisted as a versioned
collection-format field. The contract ships `@experimental` with a conformance
harness per ADR 0009 (rule of three before freeze), and the sandbox bar is
testable, not aspirational: wall-clock timeout enforced, filesystem and
network access absent, escape attempts asserted to fail, script errors
surfaced to the UI rather than swallowed. API surface stays deliberately
small (`env`, `log`, request/response mutation); no `require`, no npm, the
path that turned Proxyman's scripting into a support surface instead of a
feature.

### 4. New send paths are transports; protocols scope to WebSocket + SSE

`RequestTransport` already isolates the runner from URLSession. WebSocket and
SSE land as sibling transports with conformance tests, streaming-aware detail
rendering, and a frame console. gRPC is deferred past completion, explicitly:
it needs proto descriptor loading or server reflection plus a dependency
decision (grpc-swift), which is weeks of lift for a protocol whose dev-loop
share doesn't justify blocking release readiness. Deferred, not ruled out;
the transport seam keeps it cheap to add later.

## Consequences

- Table stakes first means the first shippable milestone is parity work with
  zero novelty: body viewers, waterfall, real OAuth2 flows, cookies, editor
  depth, collection UX, folder runs. Boring by design; it unblocks everything
  users touch daily.
- Public API grows by at least one contract (`ScriptRuntime`) under the
  forever-commitment rule; staging as `@experimental` until a third consumer.
- The collection file format gains fields (scripts now, rule references when
  rules become saveable); round-trip byte-identity tests extend per house
  rule.
- Rockxy/FRTMProxy validate demand for native-Swift debuggers but compete on
  the proxy axis; our answer to them is the SDK fleet, not cert management.
- Feature ideas were taken from competitors' public docs and READMEs
  (Proxyman, Bruno v4, Yaak 2026.x, Rockxy); no code was read with intent to
  copy and none may be — Rockxy's source is AGPL-3.0 and verbatim reuse would
  infect this repo's license.

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
