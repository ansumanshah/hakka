---
title: 'ADR 0012 — gRPC sending, phase 1: unary over grpc-swift-2, raw mode only, reflection cut'
description: The dependency decision for gRPC sending (grpc-swift-2 + grpc-swift-nio-transport, scoped to apps/hakka only), why server reflection was cut from phase 1 entirely, and how the send path reuses RequestSpec/RequestResolver/GrpcBodyDecode instead of building parallel plumbing.
---

Status: Implemented (phase 1, unreleased) · Date: 2026-08-22 · Extends [ADR 0010](/contributing/adr/0010-desktop-completion/) · Applies [ADR 0009](/contributing/adr/0009-contracts-first-internals/)

## Trigger

ADR 0010 shipped gRPC **inspection** (decoders, frame viewer, status-from-trailers)
and deferred **sending**, for one reason: `URLSession` exposes no public API for
HTTP/2 trailers, and gRPC's real outcome — `grpc-status`/`grpc-message` — travels
in trailers. A compliant client needs a real HTTP/2 stack, tracked separately in
`.claude/strategy/grpc-sending-2026-08.md` at a 3–5 week estimate for the whole
feature. The owner reversed the deferral on 2026-08-22: users are asking for
sending, not just inspection. This ADR covers **phase 1** — unary calls only,
built as one bounded slice of that estimate, not the whole thing.

## Options considered — HTTP/2 client

**A. `grpc-swift-2` (`GRPCCore` + `GRPCNIOTransportHTTP2Posix`).** The
NIO-based rewrite (not the deprecated `grpc-swift` v1 tree, "SwiftGRPC" era).
`GRPCClient.unary(request:descriptor:serializer:deserializer:options:onResponse:)`
takes a `MethodDescriptor` (plain `service`/`method` strings — no codegen
required) and a caller-supplied `MessageSerializer`/`MessageDeserializer`, so a
raw `[UInt8]` passthrough codec is a ~20-line conformance, not a generated
stub. `ClientResponse.Contents` separates initial `metadata`, the `message`
`Result`, and `trailingMetadata` — exactly the shape needed to surface
`grpc-status`/`grpc-message` distinctly from a transport-level failure.
`GRPCNIOTransportHTTP2Posix`'s `HTTP2ClientTransport.Posix` takes a
`ResolvableTarget` (`.ipv4`/`.dns`/…) and a `TransportSecurity` of `.plaintext`
or `.tls(...)`, covering h2c (local dev servers) and TLS from one transport.
**Accepted.**

**B. Raw `swift-nio-http2` (hand-rolled HTTP/2 framing, gRPC wire format by
hand).** Full control, zero gRPC-specific dependency surface. Rejected: this
is reimplementing exactly what A already gets right — flow control, header
compression (HPACK), trailers, connection management — for a protocol whose
correctness bar (status codes, metadata binary-header rules, message framing)
is easy to get subtly wrong. ADR 0010's original "weeks of lift" estimate
assumed something close to this option; A is why the estimate for sending
alone (not reflection, not streaming) turned out smaller.

**C. `swift-nio-transport-services` (Network.framework-backed transport)
instead of Posix.** `grpc-swift-nio-transport` ships both
(`GRPCNIOTransportHTTP2Posix` and `GRPCNIOTransportHTTP2TransportServices`);
the package's own docs recommend NIOTS on Darwin for power/perf. Not taken for
phase 1: Posix is simpler to reason about and to test (a loopback `HTTP2ServerTransport.Posix`
needs no separate code path from the client under test), and the workload
here — a developer manually sending one RPC at a time against a local or
staging server — has none of the many-thousands-of-connections profile NIOTS
optimizes for. Revisit if real usage surfaces a Network.framework-specific
need (e.g. VPN/proxy-aware routing); the transport is behind `GrpcTransport`,
so swapping it is a sibling-file change, not a rewrite.

## Dependency placement

`grpc-swift-2` (from 2.4.2) and `grpc-swift-nio-transport` (from 2.9.2) are
added to `apps/hakka/Package.swift` only. The `ios/` SDK package (consumed by
`apps/hakka` via `.package(path: "../../ios")`) gets zero new dependencies —
inspection already shipped there with no gRPC library at all (schema-less wire
decode), and sending is a Mac-app-only capability. This was a hard constraint
going in, not a discovery: the capture SDK embeds inside a host app across
five platforms and must stay dependency-free.

**Consequence:** `GRPCCore`'s use of the `Synchronization` module (`Mutex`)
requires macOS 15+. `apps/hakka/Package.swift` bumps `.macOS(.v14)` to
`.macOS(.v15)`. The app is unreleased and unsigned (ADR 0010's status sweep),
so there is no installed base on macOS 14 to break.

## Options considered — message input

**A. Raw mode only: a hex-encoded protobuf message the user pastes in.**
Trivially correct — the bytes on the wire are exactly the bytes typed, no
inference. The power-user escape hatch every API client needs regardless of
what else ships (Bruno/Postman's raw-body mode is the same idea). **Accepted
for phase 1** — see below for why it is now the *only* mode, not one of two.

**B. Server reflection (`grpc.reflection.v1`/`v1alpha`) for JSON→proto
message encoding**, per the original scope note's two-mode plan. **Cut
entirely**, not scoped down to discovery-only as the fallback plan allowed.
Two things surfaced once the reflection protocol was actually read, not
assumed:

1. **`ServerReflectionInfo` is bidirectional-streaming in both reflection
   protocol versions** — always has been, so a client can traverse dependency
   graphs across several request/response pairs on one stream. Phase 1's
   boundary is unary-only, streaming is explicitly phase 2. Reflection sits
   on the wrong side of that line structurally, not just by effort — it is
   not "unary work that happens to be large," it is streaming work.
2. Even scoped to **discovery only** (service/method names, not full JSON
   encoding — the fallback the scope note pre-approved), the response is a
   serialized `FileDescriptorProto`. Rendering it honestly means parsing
   nested `DescriptorProto`/`ServiceDescriptorProto`/`MethodDescriptorProto`
   structures by hand (no codegen, by the same constraint that keeps this
   raw-mode-first) or pulling in `SwiftProtobuf` + generated descriptor types
   — either a real, non-trivial chunk of work, before any encoding.

Doing both — minimal internal stream handling *and* hand-rolled descriptor
parsing — to ship a feature that only populates two text fields (service,
method) in an editor a user can type into directly, fails the "honest scoping
beats a half-working encoder" bar this phase was scoped against. Phase 1
ships **zero** reflection. Host, service, and method are typed directly (see
below); the message is always raw hex. Phase 2 — which already needs real
streaming-RPC plumbing for server/client/bidi calls — is where reflection
belongs, because the internal stream handling it needs stops being founder
research and becomes the same machinery phase 2 builds anyway.

## Decision — how the send path is modeled

Rather than a new `CollectionNode` case or a parallel `GrpcRequestSpec`, gRPC
requests reuse `RequestSpec` almost unmodified, the same way WebSocket reuses
it by sniffing `ws://`/`wss://` off the existing `url` field
(`WebSocketConnectionModel`'s doc comment: "a socket... never goes through
`RequestRunner` or `RunResult` at all"). gRPC's shape is closer to HTTP than
WebSocket's is — one request, one response, real metadata — so it reuses more:

- **Target + method path ride the URL.** `grpc://host:port/package.Service/Method`
  (`grpcs://` for TLS) — the same `/package.Service/Method` string gRPC
  already puts on the HTTP/2 `:path` pseudo-header, so `GrpcTarget` just
  splits a real `URL`'s host/port/scheme/path; no new "service" or "method"
  field on `RequestSpec`.
- **Metadata reuses `RequestSpec.headers`.** gRPC metadata *is* HTTP/2
  headers at the wire level. The existing Headers tab, `HeaderPair`, and
  `RequestResolver`'s `{{variable}}` interpolation all apply with zero
  changes.
- **The message is one new `BodySpec` case: `.grpcMessage(hex:)`.** It is a
  body — this is the thing that goes in the gRPC message frame — so it slots
  into the existing Body tab picker, `RequestBodyEncoder`, and
  `RequestResolver.interpolateBody` as one more case each, the same additive
  shape ADR 0011 established for wire-contract growth.
- **`RequestResolver.resolve()` runs completely unmodified.** It was already
  transport-agnostic (URL/headers/body in, `ResolvedRequest` out); gRPC needed
  none of its own resolution logic.
- **`GrpcRunner` is a new actor, sibling to `RequestRunner`**, not a branch
  inside it — ADR 0010 sub-decision 4's rule ("new send paths are transports")
  applies again. It calls `RequestResolver.resolve()` and
  `RequestBodyEncoder.encode()` unchanged, then forks only at the final step:
  instead of a `URLRequest` over `URLSessionTransport`, it builds a
  `GrpcUnaryRequest` over `GrpcTransport` (protocol) →
  `GRPCSwiftUnaryTransport` (implementation, `apps/hakka` only).
- **The response reuses `NetworkRequest`/`RunResult`/`GrpcBodyDecode`
  verbatim.** `GrpcRunner` frames the raw response bytes into the same
  length-prefixed wire format `GrpcBodyDecode` already parses for captured
  traffic, folds `grpc-status`/`grpc-message` from the real trailers `GRPCClient`
  hands back into `responseHeaders`, and returns a plain `RunResult`. Because
  `GrpcBodyDecode.resolveStatus` already has a fallback path for exactly this
  shape (`GrpcStatusSource.trailersOnlyResponseHeader`, written for HTTP/2
  Trailers-Only responses), no decoder code changes at all — the send path
  produces data the existing viewer already knows how to render. This is the
  literal request: "decode with the EXISTING inspection decoders, do not
  duplicate."
- `DetailPaneView` needed **zero changes**: it already renders
  `model.editor.lastResult.record` through the generic `NetworkRequestDetailView`
  for any non-WebSocket URL, and `BodyViewerRegistry` already routes
  `application/grpc*` content types to the gRPC frame viewer.

**Consequence — `RequestSource` gains a `.grpcClient` case** in
`ios/Sources/Common/NetworkRequest.swift` (an enum case, no dependency; the
constraint above is about the grpc-swift dependency, not all edits to that
file) so a gRPC-originated record doesn't misreport itself as `.urlSession`.

## Consequences

- `apps/hakka`'s deployment target moves to macOS 15 — see above.
- Phase 1 ships **no** service/method discovery UI. A user who doesn't already
  know the service and method name must get them elsewhere (`grpcurl -plaintext
  host:port list`, source, docs) and type `grpc://host:port/pkg.Service/Method`
  by hand. This is the honest cost of cutting reflection; phase 2 removes it.
- Metadata tab is literally the Headers tab relabeled by context — a gRPC
  request's Auth/Tests/Scripts tabs stay visible but inert (no cookie jar,
  no assertions, no scripts run for a gRPC send in phase 1). Not hidden,
  because hiding them conditionally across the tab strip was judged more risk
  for phase 1 than value; a rough edge, not a defect, and cheap to tidy in
  phase 2.
- `BodyKind`'s picker gains a `.grpcMessage` case that only appears for a
  `grpc://`/`grpcs://` draft (and every other kind is hidden for one) — one
  more `BodySpec` case through the same exhaustive switches
  `RequestBodyEncoder`/`RequestResolver`/`RequestBodyTabView` already have,
  not a new editor architecture.
- The transport seam (`GrpcTransport`) is real, not aspirational: phase 2's
  server/client/bidi streaming and reflection both build behind it, the same
  way ADR 0010 predicted gRPC would stay "cheap to add" once WebSocket/SSE
  proved the transport-seam shape.

## Non-goals (phase 1, restated)

Streaming RPCs (server, client, bidirectional) — explicit phase 2. Server
reflection in any form — cut, see above. Proto descriptor loading / `.proto`
file import for typed message editing. Self-signed/pinned TLS override for
local dev servers with non-system certs (system trust roots only; a
plaintext/h2c target is the documented workaround until this lands). Request
cancellation mid-flight. Per-call deadlines beyond the app's existing request
timeout field.

## Sizing (phase 1, actual)

- Dependency + raw transport (`GrpcTransport`, `GRPCSwiftUnaryTransport`,
  framing helpers) — **M**, dominated by getting metadata/trailing-metadata
  plumbing and error-vs-status disambiguation right, not by the library API
  itself.
- `RequestSpec`/`RequestResolver`/`RequestBodyEncoder` additive changes — **S**,
  by design (see Decision above) — this is the payoff of reusing the HTTP
  request shape instead of building a parallel one.
- `GrpcRunner` — **S**, thin by construction: resolve → encode → transport →
  record, no new orchestration logic.
- UI (URL-scheme-aware Body tab, method-picker hide) — **S**.
- Conformance tests + in-process test server — **M**, real HTTP/2 round trips
  (status OK, status error, metadata echo) take real setup/teardown per test.

No L-scale unknown remained once reflection was cut. Reflection (discovery
*and* JSON encoding) is folded into phase 2's estimate rather than kept
separate, per the reasoning above.

## Verification plan

- `GrpcTransportConformanceTests`: a shared assertion suite (mirroring
  `RequestTransport`/`WebSocketTransport`'s own conformance tests) run against
  `GRPCSwiftUnaryTransport` — plaintext unary round trip, TLS is exercised
  separately where a test fixture can provide a trusted cert, metadata sent
  and echoed, `grpc-status`/`grpc-message` surfaced for both OK and a
  deliberately-failing method, a transport-level failure (connection refused)
  distinguished from an RPC-level error status.
- An in-process test gRPC server: `GRPCServer` (grpc-swift-2's own server
  side, test-target only, not shipped) bound to `127.0.0.1:0` inside the test
  process, running a hand-written unary handler that echoes metadata and can
  be told to return a specific `grpc-status`. Real sockets, real HTTP/2 —
  proves the production client path, not a mocked one.
- `GrpcRunner` tests: `.grpcMessage` hex round-trips through
  `RequestBodyEncoder`/`RequestResolver` unchanged from existing body-kind
  test patterns; a `GrpcRunner.run()` against the in-process server produces
  a `NetworkRequest` that `GrpcBodyDecode.decode` parses back into the same
  frames and status the server sent — the decoder-reuse claim, proven, not
  asserted.
- `swift build && swift test --no-parallel` stays green; files under 200
  lines; `node scripts/ui-token-check.mjs` and `node
  scripts/spec-drift-check.mjs` both pass.
