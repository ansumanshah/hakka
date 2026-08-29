---
title: Hakka for macOS
description: A native desktop app that is an API client and a live traffic inspector in one, with no proxy and no CA certificate.
---

**Status: in development.** The core is built and tested (500 tests) and
`Scripts/package_app.sh` produces a runnable `Hakka.app`, but there is no signed release
yet. Track [ADR 0008](/contributing/adr/0008-desktop-plugin-products/) for the design
and scope.

Hakka for macOS is two tools that usually have nothing to do with each other:

- An **API client** — collections of saved requests, environments, variables,
  assertions, imports from cURL/Postman/OpenAPI/HAR, code generation.
- A **traffic inspector** — the live stream from your app, on this Mac or on a device,
  with filters, diffing, and export.

They are one app because of the move that neither half can do alone: see a real request
your app just made, and save it as a request you can re-run, tweak, and commit.

## Why not a proxy

Proxyman and Charles see every app's traffic because you install a CA certificate and
route your machine through them. That is a large amount of trust and a recurring
setup tax, and it is why those tools cannot be part of a normal project's onboarding.

Hakka sees _your_ app's traffic because the SDK is inside it. Smaller scope, no
certificate, nothing to install on the system. The desktop app receives what the SDK
already captured, over the same bridge the CLI and MCP server use.

The trade is explicit: Hakka cannot inspect an app you do not build. If that is what
you need, a proxy is the right tool and Proxyman is a good one.

The one exception is `hakka sim attach`, a separate, narrower path that injects the
SDK into an already-installed iOS Simulator app at process launch, still with no
certificate; see [ADR 0014](/contributing/adr/0014-simulator-injection-capture/) for
exactly what it reaches and where it stops.

## What it is made of

The app ships as Swift packages, not just a binary, so other Swift apps can host the
same surfaces ([ADR 0008](/contributing/adr/0008-desktop-plugin-products/)):

| Product       | Contains                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `HakkaCore`   | Collections, environments, the request runner, importers, code generators, the traffic store, the trace store.                    |
| `HakkaServer` | The bridge hub as a Swift actor — speaks the same wire protocol as `hakka-bridge`, so it replaces that process for desktop users. |
| `Hakka`       | The SwiftUI app itself.                                                                                                           |

`HakkaCore` depends on `HakkaCommon` — the same package the iOS SDK captures
into. A request that arrives from a device and a request the desktop app sends are the
same Swift type, which is why promoting one to the other is a conversion rather than an
import.

## What it does

**As an API client**, it is collections of files, environments, assertions and
captures, cURL/Postman/OpenAPI/HAR import, code generation into six languages, a
folder runner for smoke-testing a whole tree of requests in order, editor support for
multipart, binary and GraphQL bodies, OAuth2 (client credentials, refresh, and
authorization code with PKCE), and a per-run cookie jar. See
[The API client](/desktop/api-client/).

**As an inspector**, it streams live traffic from your app — on this Mac or a device
on the same network — with filtering, content-type-aware body viewers, a
per-request timing waterfall, WebSocket frame consoles, gRPC frame inspection, LLM
stream and token-usage display, structural diffing, and export. A deterministic,
evidence-backed one-line diagnosis explains common failures (a 401 with no
`Authorization` header, a 304 matched by `If-None-Match`, and others) without calling
out to a model. See [The inspector](/desktop/inspector/).

**Cross-target tracing** puts a mobile request and the server calls it caused on one
timeline, and labels which connected device produced each row. See
[Trace and device attribution](/desktop/trace/).

**Rules** — mocks, breakpoints, and throttle — run on the device's own SDK; the
desktop drives them over the bridge. See [Rules over the bridge](/desktop/rules/).

## Collections are files

A collection is a directory. Each request is its own small JSON file with stable key
ordering, so editing one request produces a one-file, line-oriented diff that a
teammate can actually review. Folders are subdirectories. There is no database and no
single-file blob to conflict on.

Environment _values_ live outside the collection directory, and variables marked secret
never enter it — a committed collection can reference `{{token}}` without ever
containing one.

Every collection stamps a format version. A collection written by a newer Hakka is
refused with a clear message rather than half-decoded and written back lossily; a file
with no version at all reads as version 1.

## Building it

```bash
cd apps/hakka
swift build
swift test
```

Requires macOS 14 or later and a Swift 6 toolchain. The package consumes `ios/` by
path; there is no separate checkout to clone.
