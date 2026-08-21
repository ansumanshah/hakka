---
title: Trace and device attribution
description: A mobile request and the server calls it caused, on one clock-skew-corrected timeline, with the connected device that produced each row.
---

## Cross-target trace waterfall

A request from your app and the server-side work it triggers are usually two separate
things to look at: a row in the mobile inspector, and a separate span somewhere in
`hakka-node`'s own trace. The desktop app joins them into one waterfall keyed by
`correlationId` on the client side and `traceId` on the server side, the same way the
`hakka-mcp` server's `SpanStore` and `hakka-browser`'s `groupBy: 'trace'` grouping do
it for their own surfaces — the desktop has neither of those, so it assembles both
sides of the join itself.

A trace becomes viewable the moment it holds anything at all: one request, or one span
with no request yet, since a span can legitimately arrive first (the server's capture
and the bridge relay race the client's own frame). There is no "wait until complete"
gate. This is a streaming tool; a request is routinely still in flight, and the
waterfall renders a partial bar list correctly — a pending request simply has no end
time yet.

**Clock skew.** A phone and a laptop running `hakka-node` do not share a clock, and
there is no NTP handshake in a dev-loop tool to estimate the true offset. Instead of
guessing at skew magnitude, the assembler enforces one weaker but unconditionally true
rule: an effect cannot start before its cause on the rendered timeline. A span's cause
is its parent span, or, for a root span, the request whose `correlationId` equals the
trace id. If a bar's raw start time precedes its cause's, it is clamped forward to the
cause's start — the measured duration is preserved, only the start moves — and the bar
is marked as clock-corrected so the UI can show it. This fixes the one failure mode
that actually confuses a developer, a server span appearing to start before the
client request that triggered it, without pretending to know the real skew for bars
that don't exhibit it.

The waterfall is offered only for a trace with more than one participating runtime —
a single-hop trace with no attached server capture is not worth opening a
cross-target view for.

## Device attribution

Every row in live traffic can be labeled with which connected device produced it. The
wire protocol between an SDK and the bridge carries no device name, app name, or
bundle id — adding one would be a wire-contract change that has to land atomically
across TypeScript, Swift, and Kotlin, not something the desktop app can decide alone.
So the label is honestly minimal: the bridge hub counts distinct peers in the order
their first frame arrives and calls them "Device 1", "Device 2", and so on. In the
traffic list the badge compacts to "D1", "D2"; the full label is available in the
request detail view and in the `device:` search term (for example
`device:"Device 2"`, matched as a substring against the label).

**Device labels are not stable across a reconnect.** A dropped connection gets a
brand-new peer id, and there is no honest way to prove "this is the same physical
device as before." The one candidate signal, the peer's IP address, is worthless here
because the bridge server binds loopback-only by default, so a simulator and every
other local SDK all connect from `127.0.0.1` and would collide. Reassigning "Device 1"
to whichever peer happens to reconnect first would be a guess dressed up as a fact —
actively misleading in exactly the multi-device scenario this feature exists for. A
fresh label on reconnect never lies about which device produced a row; the cost is
that a device's number can climb across a session if it drops and reconnects.
