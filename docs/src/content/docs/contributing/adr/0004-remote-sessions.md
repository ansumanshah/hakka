---
title: 'ADR 0004 — Remote debug sessions'
description: A proposed room/auth model for sharing a live Hakka capture session over a network, not just on localhost. Not yet built.
---

Status: Proposed · Date: 2026-07-11

## Context

The bridge (`packages/hakka-bridge/src`) is a localhost dev tool today: one
`BridgeHub` per process, bound to `127.0.0.1` by default, every connected
peer sees every other peer's frames, a fresh peer gets a full replay of the
buffer on connect, and the only auth is an optional static shared token plus
an `Origin` allowlist (`server.ts`). Every client — `hakka-web`'s
`desktopBridge`, `hakka-node`'s `bridgeClient`, RN/iOS/Android, and
`hakka-mcp` — speaks the same versionless envelope
(`{ type: 'request' | 'control', payload }`, `protocol.ts`). Control frames
(`ControlCommand` in `packages/hakka-core/src/engine/control.ts`: `mock.add`,
`breakpoint.add`, `throttle.set`, …) are applied wherever they land — the web
worker's `storeClient.ts`, RN's `core/bridge.ts`, iOS's `BridgeClient.swift`
— with **zero gating**: any peer on the hub, including `hakka-mcp` (which
exists specifically to call `sendControl()`), can rewrite a live response
today. That is an acceptable trust boundary on loopback, where the only
peers are the developer's own processes.

The ask is PageSpy/chii-class: turn a capture session into something you can
share with another person over a network, not just view alone on localhost.
ADR 0002 already flagged this exact moment — "Bridge hardening... not needed
by the pull model but required before any push-to-browser prod transport" —
this ADR is that hardening pass, scoped to sharing, not to production
capture (0002's cohort/ring-buffer model is unrelated and unaffected).

**Prior art.** `chii` (`server/lib/ChannelManager.js`) pairs one `target`
(the inspected device) to N `client`s by an explicit target id the client
supplies on connect — a Chrome-remote-debugging-style 1:N channel, no
implicit broadcast. `page-spy-web` calls this a "room": a device opens a
room inside a `group` namespace (`getSpyRoom(group)`), and a viewer polls the
group's room list and explicitly picks one room's `address` to join
(`SelectRoom`, now deprecated in their frontend but the model stands). Both
tools require **explicit, scoped joining** — nobody sees a stream they
didn't ask to join. Hakka's current hub does the opposite: implicit,
unscoped, broadcast-to-everyone. That gap is the core of this ADR.

**The hello-handshake lesson.** `protocol.ts` carries no version field —
`parseBridgeMessage` recognizes exactly two `type` values and drops anything
else (`parseBridgeMessage` test: `{ type: 'hello' }` → `null`, i.e. an
unrecognized type is silently and safely dropped, never a crash — that
mechanism is sound). But "drop silently" is also exactly how the protocol
already drifted once for real: the dormant `Noodle` desktop fork still
decodes `{type:'request', request}` / `{type:'batch', requests}` against
today's `{type:'request', payload}` wire, and nothing detects the mismatch —
every frame just throws inside Noodle's parser and the UI stays empty, with
no signal to either side that they've diverged. There is no handshake, so
there is no way to _ask_ a peer what it understands; incompatibility is
discovered by silence, not by negotiation. Any wire change this ADR makes
must not repeat that: it must be structurally impossible for an old client
or an old hub to misinterpret a new frame as something else, and additive
enough that "connects and gets nothing" doesn't become "connects and gets
malformed data."

## Decisions

### (a) Session rooms vs. 1:1 pairing

**Chosen: rooms on the hub** — an `id` + join token, with relay and buffered
replay scoped per room, replacing today's single implicit global room.

**Rejected — pure 1:1 pairing** (one device, one viewer, no multiplexing).
Hakka already has tested multi-peer fan-out on loopback (`server.test.ts`:
"receives a request frame, buffers it, and relays to other peers" — a
sender plus a viewer, both ordinary peers). Collapsing to 1:1 would be a
regression for the existing desktop-app-plus-browser-overlay case, not just
a missed opportunity for the new one. A room is the strict generalization:
today's implicit single room becomes "the default room every unauthenticated
loopback peer already joins," so 1:1 pairing solves nothing rooms don't
already cover, while foreclosing multi-viewer sharing (pairing a teammate in
_and_ keeping the local desktop app subscribed).

**Rejected — single shared namespace with auth bolted on** (any valid token
joins the one global stream). Rejected because it isn't a session at all —
there's no scoping, so one leaked token exposes every buffer the hub has ever
held, including buffers from apps the token-holder was never meant to see.
"Shareable debug session" implies the share boundary is per-session.

### (b) Auth

**Token transport — rejected: URL query param**, despite `server.ts`
already shipping `?token=` for the existing LAN shared-secret feature. Flag
this explicitly rather than silently reusing the pattern: a share link is
the artifact most likely to get pasted into Slack, email, or a ticket, and
URL params land in browser history, reverse-proxy access logs, and any CDN
or load-balancer request logging in front of the hub — exactly where a share
token must not appear. The existing `?token=` stays as-is for its original
purpose (a static pre-shared secret for trusted-LAN device debugging,
config-file lifetime, not a pasted link); it is a different threat model and
out of scope to change here.

**Considered — WebSocket subprotocol** (`Sec-WebSocket-Protocol`). Rejected:
subprotocol values still appear in some proxy/load-balancer upgrade-request
logs (less exposed than a URL, not zero), and `ws`'s subprotocol negotiation
is a single-string allow-list handshake — awkward for carrying a room id and
a token as two distinct values without inventing a delimiter convention.

**Chosen — first-frame auth message.** After the WS upgrade completes, the
hub requires the connection's first frame to be a join request carrying the
room id and token before it does anything else — no buffer replay, no
relay registration. This keeps the secret off the transport-level handshake
entirely, stays inside the existing frame-based envelope (additive frame
type, see (d)), and gives the hub one clean rejection point — close 1008,
same signal `server.ts` already uses for origin/token failures — before any
data has moved.

**Token generation & expiry.** Server-minted per-room, cryptographically
random (the module already imports `node:crypto` for `timingSafeEqual`;
`randomBytes` is the natural extension), one token per room rather than per
viewer — simplest shape for "give this code to whoever you're sharing with."
TTL from room creation (short default) plus explicit revoke; an
expired or revoked token is rejected exactly like a wrong one. Rooms and
their tokens live only as long as the hub process — no persistence across
restarts, matching the buffer's own lifetime today.

**Non-goal, stated explicitly: no NoodleApps cloud relay/pairing service in
1.2.** Self-hosted only. Brand rationale, not a resourcing excuse: a cloud
relay means Hakka's operator now custodies someone else's live request and
response bodies — tokens, PII, everything the redaction model in (e) is
trying to keep off the wire in the first place — on NoodleApps
infrastructure, which turns a developer-respect dev tool into a company with
uptime and breach liability. "No accounts, no enterprise" means sharing a
session is "open your port, hand out a link" — same posture as any other
localhost dev server. A user who needs off-LAN reach runs their own tunnel
(ngrok, Tailscale, Cloudflare Tunnel); Hakka does not become that
infrastructure. This is durable, not "not yet."

### (c) Viewer permissions

**Chosen — read-only by default per room.** Control frames (`mock.*`,
`breakpoint.*`, `throttle.set`) are relayed only when the room's creator
(the sharing side — the device being inspected) set an explicit
allow-control flag at room-creation time. Default off.

**Enforcement point is the hub, not the SDK.** Today, `applyControlCommand`
runs unconditionally wherever a control frame arrives — the web worker, RN's
bridge, iOS's `BridgeClient.swift` — trusting every peer equally, which is
fine when "every peer" means loopback processes the developer started
themselves. It stops being fine once a room can be joined by someone on
another network. The fix belongs at the relay: `protocol.ts` already
distinguishes `request` from `control` frames, and the hub already knows
which room a frame arrived in and that room's allow-control flag — so a
disallowed control frame is dropped at relay time and never reaches the
device's `applyControlCommand` at all. This does not require the SDK-side
engines to change, and does not depend on every current or future SDK target
self-policing correctly.

**Rejected — granular per-capability grants** (separate allow-mock /
allow-breakpoint / allow-throttle bits). Premature for 1.2: the real use
case is "I trust this one person enough to let them poke at my app together
with me," which one coarse bit covers. A permissions matrix is easy to add
later if usage shows a need for it; nothing here forecloses that.

**Rejected — control allowed by default, opt out to restrict.** Same
allowlist-beats-denylist principle ADR 0002 already established for prod
body capture: a share link goes to someone outside the developer's own
process tree, so "off unless the sharer turns it on" is the only safe
default.

### (d) Transport & wire compatibility

**Chosen — reuse the existing hub and frame envelope; add room scoping as
one new, additive frame type.** A connection that never sends a join frame
lands in an implicit default room with today's exact behavior: one shared
buffer, broadcast to every other peer, replay on connect. This is not a
fallback bolted on for compatibility's sake — it _is_ today's behavior,
unchanged, for anyone who doesn't opt in. Every currently-deployed client
(`hakka-web`, `hakka-node`, RN, iOS, Android, `hakka-mcp`) keeps working
against a room-aware hub with zero changes and zero awareness that rooms
exist. Room-scoped behavior — explicit join, token check, allow-control
gating, per-room buffer isolation — only activates for a connection that
sends the new join frame first.

**Compatibility direction that matters:** rooms are a hub-side (`server.ts`)
capability, so the only real compatibility question is _new hub, old
client_ — already handled by the default-room fallback above. The reverse
(new client against an old, not-yet-upgraded hub) degrades safely for the
same reason the "hello" test case already proves: `parseBridgeMessage`
drops any unrecognized `type` and returns `null`; an old hub receiving a
join frame just ignores it and treats the connection as an ordinary
unauthenticated peer of the single global room — the pre-1.2 behavior,
not a crash, not corrupted data.

**Applying the hello-handshake lesson:** the new join frame is additive —
one more recognized `type` alongside `request`/`control`, never a
repurposing of `payload` or the existing `type` enum. This ADR does **not**
add a protocol version field or a capability-negotiation handshake; that is
a real gap the versionless design has (the Noodle drift is proof), but
closing it is out of scope for 1.2. The mitigation here is narrower and
sufficient for this feature: new behavior is opt-in via a new frame, so
"peer doesn't understand rooms" degrades to "peer behaves as it always did,"
never to "peer misparses new data as old data." Flag versionless-protocol
negotiation as a real follow-up, not solved here.

### (e) Privacy invariant — redaction before frames leave the device

**Stated as a testable invariant:** no unredacted sensitive header or body
value may ever be included in a frame handed to `bridgeClient.send()` (or
the browser `desktopBridge` socket send). Redaction must complete inside the
same synchronous capture path that builds the `NetworkRequest` — before that
object is serialized onto the wire — regardless of which room it's destined
for. Rooms only change _who can receive_ an already-redacted frame; they
must never become a reason to redact later. "Redact at the hub, now that
there are remote viewers" is explicitly the wrong design: it would mean an
unredacted body has already transited process memory and the wire on its
way to the hub, which is precisely the exposure the invariant exists to
prevent.

**Existing test anchors** (real, today): `packages/hakka-core/src/utils/headerRedaction.test.ts`
and `packages/hakka-core/src/utils/bodyRedaction.test.ts` cover the redaction
functions themselves. `packages/hakka-core/src/capture/fetch.ts` calls
`isSensitiveHeader` / `redactJsonBody` while building
`recordedReqHeaders`/`recordedResHeaders`/the redacted body _before_
constructing the `NetworkRequest`, and `hakka-node/src/bridgeClient.ts`'s
`send()` only ever receives that already-built object. **No existing test
asserts the order end-to-end** — nothing proves a raw secret never reaches
`bridgeClient.send`'s `JSON.stringify`, only that the redaction functions
work correctly in isolation.

**Test added — and it did not pass unchanged.** `packages/hakka-node/src/__tests__/redactionBoundary.test.ts`
runs a real `http` request through the real interceptor into a real bridge
client and asserts against the exact string a real socket receives. Header
redaction held. Body redaction did not: three capture paths built records
from the raw payload, because only `fetch` and XHR ever called
`redactJsonBody`.

- `hakka-node/src/httpInterceptor.ts` — every `axios`/`got`/`node-fetch`
  request body, i.e. the whole Node and Next.js server side.
- `hakka-browser/src/capture/sendBeacon.ts` — analytics beacons, which is
  precisely where session tokens travel.
- `hakka-core/src/capture/websocket.ts` — text frames, so an auth frame
  like `{"type":"auth","token":…}` was captured verbatim.

All three now redact at their own chokepoint, inside the synchronous capture
path, and are fenced by tests that fail without the fix. Local-only usage
hid this because only the developer's own processes ever saw the frame; the
invariant is now enforced rather than assumed, which is what remote sharing
needed before it could ship.

### (f) Backpressure, replay limits, rate limits

**Chosen — one `BridgeHub` instance per room**, not a shared hub filtered by
room id. Replay-on-connect scopes to the joining room's own buffer only.
`maxRecords` stays configurable per room (already an option on `BridgeHub`
and `startBridgeServer`) rather than one global cap, so one room's chatty
app can't starve another room's buffer — and, more importantly, can't leak
into another room's replay. A structurally separate hub instance per room is
the safer implementation than a shared instance with a room-id filter: a
filtering bug leaks data across rooms, a separate instance structurally
cannot.

**Rate limits.** Room _creation_ is sharer-initiated — the sharing side
already trusts the local machine, so this is lower severity than relay
volume from a joined viewer. The real gap is per-connection message rate on
the relay path: a joined-but-misbehaving viewer flooding control frames, or
a compromised/buggy device flooding request frames. A simple token bucket
per socket, closing (1008) on sustained violation, covers both; the `clients`
set iteration in `server.ts` is already the chokepoint to instrument.

**Backpressure.** `bridgeClient.ts` already bounds the _sending_ side (a
1000-record / 5 MB offline queue). The gap is the hub's _relay_ side: a slow
remote viewer. `safeSend` in `server.ts` today is fire-and-forget with no
`bufferedAmount` check — fine when every peer is loopback-speed, not fine
once a real network viewer with real latency is a peer. Add a per-socket
`bufferedAmount` ceiling; past it, drop further relay to that viewer (don't
queue it server-side) until it drains. This is genuinely new: nothing in the
current trust model anticipates a peer that isn't loopback-fast.

### (g) LAN spike — GO/NO-GO for shipping 1.2

**Spike definition:** two physical devices on one LAN — one running the app
plus `hakka-bridge` bound non-loopback (`host: '0.0.0.0'`, already a
documented, existing `BridgeServerOptions` field), the other a remote viewer
on the same network, no VPN/tunnel in the loop. One shared room, joined by
typing in (or scanning/pasting) the room id and token.

**GO criteria** — all must hold:

- Viewer joins with a valid token, sees the buffered replay, then sees new
  requests stream live.
- A wrong or expired token is rejected before any buffer replay happens (no
  partial leak on the way to rejection).
- A viewer without the allow-control flag cannot mutate mock, breakpoint, or
  throttle state on the shared device — checked as an explicit negative
  case, not inferred from "nothing broke."
- Closing one room does not affect any other concurrently open room on the
  same hub process.

**NO-GO criteria** — any one blocks shipping the feature (not the ADR):

- The token appears in any log line reachable under default OS, router, or
  proxy logging observed during the spike — the exact failure mode (b)
  exists to prevent.
- A slow or flaky remote viewer measurably degrades throughput for the
  local/loopback peers — a backpressure-isolation failure per (f).
- The redaction-boundary test from (e) fails against a real captured secret
  carried over the LAN path.

The spike proves the room + auth + gating mechanics under real network
conditions with the minimum topology that can prove them; it is not a
performance or scale test. Multi-viewer and multi-room-under-load are out of
scope for this GO/NO-GO gate, though the room-isolation GO criterion above
is cheap to check with two rooms instead of one.

## Sizing

- **(a) rooms on the hub — M.** `BridgeHub` already isolates buffer and
  dedup logic per instance; keying multiple instances by room id plus adding
  join/room bookkeeping to `server.ts` is bounded, not a rewrite.
- **(b) auth (join frame, token mint/expiry/revoke) — M.** One new frame
  type plus token lifecycle bookkeeping; no new crypto primitives (`randomBytes`
  and `timingSafeEqual` are already in use in `server.ts`).
- **(c) viewer permission gating — S.** One boolean per room, checked at a
  relay chokepoint that already exists.
- **(d) wire compatibility — S.** Additive frame type, default-room
  fallback preserves all current behavior byte-for-byte; the cost here was
  confirming that, not writing it.
- **(e) privacy invariant + test — S.** The invariant already holds
  structurally today; this is one new boundary test, and it should pass
  without a source change unless it finds a real gap.
- **(f) backpressure, replay/rate limits — M.** Per-room hub instances are
  straightforward; `bufferedAmount` ceilings and token-bucket rate limiting
  on the relay path are genuinely new operational code with new failure
  modes to get right the first time.
- **(g) LAN spike — S.** The infrastructure it depends on (multi-room hub,
  join auth, control gating) has to exist first; the spike itself is a
  manual two-device test against already-built pieces.

**Overall: M.** The pieces most likely to slip are (f) — new failure modes
(slow viewers, rate limiting) that loopback-only Hakka has never had to
handle — and the log-leak half of (b), which depends on whatever reverse
proxy or infrastructure a self-hosting user puts in front of the hub, i.e.
partially outside Hakka's control. That half is a documentation obligation
(tell users plainly: don't front the bridge with a proxy that logs upgrade
request lines) as much as a code one.

## Verification plan

- **Unit:** join-frame parsing (valid/expired/wrong-token/missing-room, all
  reject without side effects); per-room `BridgeHub` isolation (a request
  ingested in room A never appears in room B's `getRecords()` or replay);
  control-frame relay is dropped when a room's allow-control flag is unset,
  relayed when set.
- **Integration:** extend the `server.test.ts` e2e pattern — two rooms, two
  senders, two viewers, one viewer per room; assert each viewer only ever
  receives its own room's replay and live frames, and that a control frame
  from a disallowed viewer never reaches the sharing peer's socket. Add the
  redaction-boundary test from (e) as a named prerequisite, gating this
  feature's rollout, not folded silently into unrelated capture tests.
- **Security:** token compared in constant time (mirror the existing
  `isTokenValid` pattern); a room's join secret never appears in any
  server-side log line the bridge itself emits; a rejected join closes
  before any buffer replay (assert ordering, not just the eventual close
  code) — same discipline `server.test.ts`'s origin/token tests already
  apply to the existing gates.
- **Manual (LAN spike):** the GO/NO-GO checklist in (g), run against two
  real devices before 1.2 ships the feature.
