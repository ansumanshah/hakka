# Hakka for macOS

A native API client and live traffic inspector in one app. No proxy, no CA certificate —
the traffic comes from Hakka's SDK running inside your own app.

**In development.** The core is tested (113 tests), the app builds, bundles, and launches —
verified: three-pane window, collection tree, live-traffic section, native menu bar. What it
does not have yet is a signed, notarized release build.
Design and scope: [ADR 0008](../../docs/src/content/docs/contributing/adr/0008-desktop-plugin-products.md).

```bash
swift build     # macOS 14+, Swift 6 toolchain
swift test

# Bundle and run it as a real .app
./Scripts/package_app.sh debug
open Hakka.app
```

## Layout

| Path              | Product       | What it holds                                                                                           |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------------------- |
| `Sources/Core`    | `HakkaCore`   | Collections, environments, request runner, importers, code generation, traffic store. No UI, no server. |
| `Sources/Server`  | `HakkaServer` | The bridge hub as a Swift actor, speaking `hakka-bridge`'s wire protocol.                               |
| `Sources/App`     | `Hakka`       | The SwiftUI app shell.                                                                                  |
| `Tests/CoreTests` | —             | Swift Testing suites for the two library products.                                                      |

The libraries are the deliverable; the app is a thin host. Another Swift app (Noodle,
Ramen) can depend on `HakkaCore` and get collections and the runner without
inheriting a window.

## Depends on `ios/` by path

`Package.swift` consumes `../../ios` for `HakkaCommon` (the record contract, engines,
export writers) and `HakkaUI` (the inspector views). That is deliberate: the desktop app
must agree with the SDK's `NetworkRequest` byte-for-byte, and a fork would drift the
first time a bug is fixed on one side.

`ios/Sources` stays canonical — never copy from it into this package, and never edit it
from here to make something compile.

## Conventions

Swift 6 strict concurrency, files under 200 lines, one primary type per file, actors for
shared mutable state, protocol-based injection so tests never touch the network, and
Swift Testing (`@Test`/`#expect`) rather than XCTest.
