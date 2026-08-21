---
title: Rules over the bridge
description: Mocks, breakpoints and throttle run inside your app's own SDK; the desktop drives them over the bridge, with no certificate and nothing intercepted.
---

The mock, breakpoint and throttle engines already ship inside every Hakka SDK. The
desktop app is a way to drive them from your Mac, over the same bridge the traffic
arrives on. No certificate is involved, because nothing is being intercepted: the
engine doing the work is already inside your app.

Delivery is always reported, including "no devices connected". The wire is
fire-and-forget with no acknowledgement, so silence would be indistinguishable from
success.

## Mocks

Serve a canned response for matching requests. The rule matches the endpoint, not one
exact query string — scheme, host, port and path, with volatile query parameters
dropped — using substring semantics against the full request URL.

**Promote a captured response into a mock in one action** — the move a proxy cannot
make, because a proxy never had your app's response in the first place. Promotion
freezes the request's actual status, headers and body into a mock rule the device
engines then serve verbatim. A request that is still pending or that failed at the
network layer refuses to promote rather than fabricating a `200 ""` mock that would
silently mask the original failure. Re-promoting the same request replaces the
existing rule instead of piling up duplicates.

## Breakpoints

Breakpoints pause a live request on the device and let you inspect and edit it before
it continues, from the desktop.

A device's breakpoint engine blocks the paused request on a semaphore with no timeout
of its own — only an explicit resume, an explicit abort, or the device's own app
quitting ever wakes it. The desktop is therefore the only thing that can un-wedge a
live pause short of force-quitting the app on the device, which is why every path that
could end without an explicit resume or abort is treated as a bug:

- **You step away.** A pause left unanswered for 5 minutes is auto-aborted on your
  behalf, long enough to actually read and edit a request, short enough that a
  forgotten pause doesn't leave a real device's network stack blocked for the rest of
  the day.
- **The device disconnects mid-pause.** The wire carries no way to tell "that device
  dropped" apart from "that device is just slow to reconnect" — `device` on the pause
  frame is a free-text label, not a connection handle. Rather than guess, a
  disconnected device's pause is left to resolve the same way an unanswered one does,
  and a manual resume or abort against it reports honestly: zero devices reached
  reads as "no devices connected", not a false "resolved".
- **You quit the app with pauses outstanding.** Quitting holds termination open just
  long enough to send an abort for every still-open pause — otherwise a closed laptop
  lid would leave every paused device blocked forever, since nothing else is coming to
  release them.

## Throttle

One device-global network profile — Fast 3G, Slow 3G, EDGE, or Offline — applied to
every connected device until it is set back to None. The desktop's control surface
picks from these named profiles; it does not currently expose a custom latency and
bandwidth pair, even though the underlying wire command and the on-device engine
support one.
