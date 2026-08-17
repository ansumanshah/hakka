---
title: Security & threat model
description: The honest threat model for the Hakka bridge hub — who can connect, what they see, what they can do, and what mitigates it today.
---

Hakka captures real request/response traffic from your app, including
whatever headers and bodies your app sends. The [bridge hub](/bridge/overview/)
is the one place that traffic leaves the process that captured it and
becomes reachable over a network socket — even a loopback one. This page is
the honest threat model for that hub: what it protects against today, what it
doesn't, and what's planned. See [SECURITY.md](https://github.com/ansumanshah/hakka/blob/main/SECURITY.md)
to report a vulnerability.

## The short version

The bridge is a **local development tool**, not a hardened network service.
By default it only accepts connections from the same machine, but the
WebSocket protocol itself is unauthenticated and unencrypted (`ws://`, not
`wss://`). Anything that can open a socket to the bridge port can read every
captured request and send commands that change your app's live traffic. Do
not run the bridge on a machine or network you don't trust, and don't open it
to a LAN unless you understand what that grants everyone on that LAN.

## Transport: cleartext WebSocket

The bridge speaks plain `ws://`, not `wss://` — there is no TLS. On
`localhost` this is normal for a dev tool (the traffic never leaves the
loopback interface, so there's no network to eavesdrop on). If you bind the
hub to a LAN address (see below), frames travel across that LAN in the
clear — anyone who can capture packets on that network segment (a shared
office Wi-Fi, a compromised device on the same subnet) can read them, same as
any other unencrypted local protocol.

## Who can connect

`hakka-bridge` binds `127.0.0.1` (loopback) on port `8989` by default —
nothing off-box can reach it, regardless of any other setting. Three things
gate a connection once a socket does reach the listener, and only the first
one is unconditional:

1. **Loopback binding (on by default).** The `host` option defaults to
   `127.0.0.1`. Passing `host: '0.0.0.0'` (or a specific LAN address) — for
   on-device debugging from a phone or another machine — makes the hub
   reachable from **any device on that network**, not just yours.
2. **Origin check (on by default, browser peers only).** The hub rejects any
   WebSocket handshake carrying a browser `Origin` header that isn't
   `localhost` / `127.0.0.1` / `[::1]` (any port), unless it's explicitly
   allow-listed via `allowedOrigins`. This stops a stray browser tab on some
   other page from silently opening a cross-origin WebSocket to your
   loopback port and reading your traffic. It does **not** gate non-browser
   clients — a CLI script, another local process, or a peer on an opened LAN
   never sends an `Origin` header, so this check does not see them at all.
3. **Shared token (off by default).** `startBridgeServer` accepts a `token`
   option; when set, a connecting client must supply the same value as
   `?token=` on the connection URL, checked in constant time. When unset —
   the default — **no credential is required to connect at all.**

Net effect for the default configuration (loopback, no token): **any process
running as any user on the same machine** can open a WebSocket to
`ws://localhost:8989` and become a full peer — no password, no prompt, no
OS-level permission check beyond "can this process open a TCP socket." If you
open the hub to a LAN (`host: '0.0.0.0'`) without setting a token, that
becomes **any device on that LAN**.

## What a connected peer sees

On connect, the hub immediately replays its buffered history (up to
`maxRecords`, default 1000) to the new peer, then streams every subsequent
captured request live. That's every request your app has made since the hub
started (or since the buffer wrapped), including:

- Full URLs, methods, status codes, and timing
- Headers, **minus whatever's redacted by the layer that peer reads through.**
  Two separate redaction passes exist, with two different default lists (see
  [Redaction](/spec/redaction/) for the full picture):
  - **At capture time**, the SDK applies `HakkaConfig.redactHeaders`, which
    defaults to just four names — `authorization`, `proxy-authorization`,
    `cookie`, `set-cookie` — before a record ever reaches the bridge wire. A
    peer connecting straight to the bridge (raw WebSocket, not through
    `hakka mcp`) sees only this narrower default applied, unless the app
    overrides `redactHeaders` itself. See the
    [`HakkaConfig` options table](/core/overview/) for how to extend it.
  - **At the `hakka mcp` layer**, `RequestStore` redacts headers a second time
    before serving them through `list_requests`/`get_request`/`search_requests`,
    calling `redactHeaders()` with no explicit list — which falls back to the
    broader `DEFAULT_SENSITIVE_HEADERS` (18 literal header names plus 2 glob
    patterns for `x-*-token`/`x-*-secret`). So an agent reading through
    `hakka mcp`'s tools gets more headers redacted than a raw bridge peer does.
  - Either way: API keys in custom headers, session tokens, or bearer tokens
    under a header name neither list covers are **not** redacted unless you
    add them to `redactHeaders` yourself.
- **Request and response bodies, in full, by default.** Body redaction
  (`configureBodyRedaction`) is off until you turn it on — there is no
  default list of body fields Hakka blanks out. If your app sends passwords,
  tokens, or PII in a JSON body, that body reaches the bridge, and any
  connected peer, byte-for-byte. `hakka mcp`'s `diagnose` tool will warn you
  when it spots a plaintext `password`/`token`/`secret`-shaped field in a
  captured body — but that's a heads-up, not a redaction; the field is still
  there in `get_request` and `list_requests` until you configure body
  redaction.

Bodies reach an AI agent through `hakka mcp`'s tools exactly as they reach any
other bridge peer, byte-for-byte — the MCP server is a bridge peer like any
other, and it doesn't add body redaction. Headers differ: `hakka mcp`
applies its own broader header-redaction pass, so what an agent
sees through `list_requests`/`get_request`/`search_requests`/the
agent-context pack is not identical to what a raw bridge peer receives on the
wire — it's redacted further.

## What a connected peer can do

Beyond reading, a peer can **write**. Any client can send a
`{ type: 'control', payload }` frame; the hub relays it to every other
connected peer without validating the payload's shape — that validation is
the receiving peer's job (the app-side SDK, via `parseControlCommand`). This
is exactly how `hakka mcp`'s write tools work: `create_mock`, `set_breakpoint`,
and `set_throttle` all send control frames this way. Nothing about the
protocol distinguishes "the MCP server, driven by an AI agent I'm running" from
"any other peer that connected to the same hub" — both are just senders of
`control` frames.

Concretely, any peer that can reach the hub can, in a connected dev build:

- **Install mock/redirect/block rules** — silently swap real responses for
  fabricated ones, or block requests outright
- **Set breakpoints** — pause matching requests or responses mid-flight
- **Change throttle/network-condition simulation** — including forcing
  `offline`

This is traffic manipulation, available to anyone who can
open a socket to the hub, with no confirmation step on the receiving app.
It's fire-and-forget by design (there's no ack), which also means a hostile
peer gets no feedback on whether a command landed — but the app-side effect,
if it does land, is real.

## Mitigations available today

All three ship now and the first is on unconditionally by default:

- **Loopback-only binding.** Don't pass `host: '0.0.0.0'` (or any non-loopback
  address) unless you specifically need LAN device debugging, and only do
  that on a network you trust.
- **Origin checking.** On by default, no configuration needed — closes the
  "stray browser tab" attack without you doing anything.
- **Shared token.** Pass `token` to `startBridgeServer` (or the equivalent
  option on `hakka-node`/`hakka-node/next`/`hakka mcp`'s embedded hub) for defense
  in depth, especially when you've opened `host` for LAN debugging. Every
  peer — including `hakka mcp` and the web/RN overlays — must then supply the
  same `?token=` to connect. This is the strongest mitigation available today
  and it is opt-in; consider it required, not optional, whenever `host` is
  anything other than loopback.

None of the above is meant to survive a genuinely hostile LAN or a
compromised machine. It's sized for the two realistic dev-machine threats:
an unrelated browser tab probing your loopback port, and an untrusted device
on the LAN once you've deliberately opened the hub up for on-device testing.

## What's coming

Extending the bridge from a localhost dev-tool into shareable, authenticated
debug sessions — so a teammate can view your traffic from a different network
without you opening the hub to your whole LAN — is a proposed design (ADR
0004: remote debug sessions), not shipped code. Nothing below is available
today; it's here so the direction is public before it lands.

The shape being proposed: per-session **rooms** on the hub (replacing today's
single implicit global room), joined with a server-minted, per-room token
sent in a first-frame join message rather than a URL query parameter
(URL-based tokens leak into browser history and proxy access logs — a real
concern once a session can be shared as a link). Viewers would be
**read-only by default** — a room's creator has to explicitly opt a room
into allowing control frames (mocks/breakpoints/throttle) from a joined
viewer, inverting today's "every peer can send control frames" default.
Redaction stays where it already is — completed before a frame is built,
never deferred to "redact at the hub because there's a remote viewer now."

Until this ships: every peer on a hub — local or LAN — has equal read and
control access. Track the [changelog](https://github.com/ansumanshah/hakka/blob/main/CHANGELOG.md)
for when session-scoped auth lands.

## Recommendations

- Leave `host` at its loopback default unless you have a specific reason not
  to.
- If you do open `host` for LAN device debugging, set a `token` at the same
  time — don't ship one without the other.
- Configure `configureBodyRedaction([...])` for any field your app sends that
  you wouldn't want to show up in a captured body — passwords, tokens, PII.
  Header redaction alone does not cover this.
- Treat the bridge like you'd treat any other unauthenticated local dev
  server (a bare `next dev`, a debug HTTP endpoint) — fine on your own
  machine, not something to expose further without adding auth yourself.
