---
title: Hakka for macOS
description: A native API client and live traffic inspector for SDK and proxy captures.
---

**Status: in development.** The app has automated core, bridge, and app-model tests, and
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

## SDK and proxy capture

SDK capture observes calls inside your app and sends the records to the desktop over
Hakka’s bridge. It needs no system proxy or CA certificate.

For apps you cannot instrument, [proxy capture](/proxy/overview/) runs an optional
local mitmproxy sidecar and streams records to the same bridge. Configure the target
app or device to route traffic through it; HTTPS requires trusting that sidecar’s CA.
Certificate pinning and traffic that bypasses the proxy can prevent capture.

`hakka sim attach` is another, narrower path that injects the SDK into an installed
iOS Simulator app at launch. See [ADR 0014](/contributing/adr/0014-simulator-injection-capture/)
for its scope.

Use the toolbar or Inspector menu to place detail on the right, below traffic, or
hide it. The placement persists between launches. Native splitters resize each pane;
Command-Shift-I selects the right inspector and Command-Option-I selects the bottom.

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

Requires macOS 15 or later and a Swift 6.1 or newer toolchain. The package consumes `ios/` by
path; there is no separate checkout to clone.

## Verify local capture

Build the JavaScript packages with `bun run build`, then bundle and open the desktop:

```bash
cd apps/hakka
./Scripts/package_app.sh debug
open Hakka.app
cd ../..
node examples/desktop-bridge/run.mjs
```

The demo sends four requests to a local server and verifies that the bridge relays
the captures with redacted credentials and trace correlation. In **Live Traffic**,
inspect the POST body and the 503 response, then save a request to a collection
and send it again. The server stays up until Ctrl-C; `--check` runs the assertions
and exits. See the [example walkthrough](https://github.com/ansumanshah/hakka/tree/main/examples/desktop-bridge).

The default desktop bridge accepts connections from this Mac on port 8989. It does
not advertise Bonjour or accept physical-device LAN connections by default. The
`HakkaServer` library exposes `allowLAN` and token options for custom hosts; the
stock desktop app does not provide those settings. For Node, use
`register({ embedBridge: false })`; for the Next.js example, set `HAKKA_DESKTOP=1`
to use the desktop's hub. Only one hub should own port 8989.
