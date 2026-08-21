---
title: Hakka for macOS
description: A native desktop app that is an API client and a live traffic inspector in one, with no proxy and no CA certificate.
---

**Status: in development.** The core is built and tested (318 tests) and
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

## What it is made of

The app ships as Swift packages, not just a binary, so other Swift apps can host the
same surfaces ([ADR 0008](/contributing/adr/0008-desktop-plugin-products/)):

| Product       | Contains                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `HakkaCore`   | Collections, environments, the request runner, importers, code generators, the traffic store. No UI.                              |
| `HakkaServer` | The bridge hub as a Swift actor — speaks the same wire protocol as `hakka-bridge`, so it replaces that process for desktop users. |
| `Hakka`       | The SwiftUI app itself.                                                                                                           |

`HakkaCore` depends on `HakkaCommon` — the same package the iOS SDK captures
into. A request that arrives from a device and a request the desktop app sends are the
same Swift type, which is why promoting one to the other is a conversion rather than an
import.

## What it does

**As an API client**

|                 |                                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collections     | Folders and requests, each request its own file. Headers and auth inherit collection → folder → request.                                                             |
| Environments    | Named variable sets with `{{name}}` interpolation. A request that references a variable with no value is refused rather than sent with the placeholder intact.       |
| Assertions      | Declarative checks on status, duration, headers, JSON paths, and body text — no embedded scripting language, so they stay diffable and runnable headlessly.          |
| Captures        | Pull a value out of a response into a variable, so a login request feeds the token to everything after it.                                                           |
| Import          | cURL commands, Postman v2.1, OpenAPI 3, and HAR (including Hakka's own export).                                                                                      |
| Code generation | cURL, JavaScript `fetch`, Swift `URLSession`, Python `requests`, Go `net/http`, HTTPie — each with a redacting mode so a snippet is safe to paste into a bug report. |
| Cookies         | A private cookie jar per run, so a session survives a login and nothing ever touches your system cookie store. A `Cookie` header you set yourself always wins.       |

**As an inspector**

|              |                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live traffic | Streamed from your app over the bridge, on this Mac or a device on the same network.                                                                                     |
| Filtering    | Method, status class, host, content type, duration and size thresholds, and text search across URL, headers, and body. Filters you use often can be saved as presets.    |
| Bodies       | Content-type dispatch: JSON tree with syntax highlighting and search, image preview, hex dump, plain text. A display cap keeps a huge body from freezing the window.     |
| Timing       | A per-request waterfall built from URLSession task metrics, so DNS, TLS, connect, time to first byte and download are measured rather than guessed.                      |
| LLM streams  | A `text/event-stream` response gets its events assembled and its token usage surfaced. Capture keeps the tail of a stream, because that is where the usage numbers live. |
| Diff         | Compare two requests structurally — status, headers added/removed/changed, and a line-level body diff.                                                                   |
| Export       | HAR and session files, using the same field mapping the SDKs already use.                                                                                                |
| Bridge hub   | Built in, so there is no separate `hakka-bridge` process to run. Bonjour advertises it to devices; LAN exposure is opt-in.                                               |

## Rules, aimed at a running device

The mock, breakpoint and throttle engines already ship inside every Hakka SDK.
The desktop app is a way to drive them from your Mac, over the same bridge the
traffic arrives on. No certificate is involved, because nothing is being
intercepted: the engine doing the work is already inside your app.

| Section     | What it does                                                                                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mocks       | Serve a canned response for matching requests. **Promote a real captured response into a mock in one action** — the move a proxy cannot make, because a proxy never had your app's response in the first place. |
| Breakpoints | Install and remove breakpoint rules on the device. Pausing and editing a request in flight is not wired up yet.                                                                                                 |
| Throttle    | One device-global network condition: a named profile or a custom latency and bandwidth pair.                                                                                                                    |

Delivery is always reported, including "no devices connected". The wire is
fire-and-forget with no acknowledgement, so silence would be indistinguishable
from success.

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
