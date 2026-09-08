# Hakka for macOS

A native API client and live traffic inspector in one app. Capture through Hakka's SDK
or the optional managed proxy for apps and devices routed through it.

**In development.** The app includes an API client, live traffic inspector, collection
Git tools, and an opt-in local MCP server. Build and test it from source; a signed,
notarized release is not available yet.
Design and scope: [ADR 0008](../../docs/src/content/docs/contributing/adr/0008-desktop-plugin-products.md).

Transport tests require Bun and the repository dependencies (`bun install --frozen-lockfile`
from the repository root). Run the following commands from `apps/hakka`:

```bash
swift build     # macOS 15+, Swift 6.1+ toolchain
swift test

# Bundle and run it as a real .app
./Scripts/package_app.sh debug
open Hakka.app
```

## Try live traffic

After opening the app, run `node examples/desktop-bridge/run.mjs` from the repository
root (build the JS packages first with `bun run build`). It creates four local requests,
checks that the desktop bridge relays redacted captures, and keeps the local server
alive for replay. See the [walkthrough](../../examples/desktop-bridge/README.md).

The desktop bridge listens on port 8989 and accepts local connections by default.
Stop a separate Node bridge before opening Hakka. In your Node app use
`register({ embedBridge: false })`; in the Next.js example use `HAKKA_DESKTOP=1`.

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

## Releasing

Dev loop: `Scripts/compile_and_run.sh` (ad-hoc signed, local only).

Distribution: `Scripts/sign-and-notarize.sh` — universal build, Developer ID
signing with hardened runtime, notarization, staple, zip. One-time credential
setup lives in the comment at the top of that script (a Developer ID
Application certificate and a `notarytool` keychain profile). Bump
`BUILD_NUMBER` in `version.env` before every re-release; Apple rejects
duplicate uploads.

The app is not sandboxed (it binds a local bridge server), ships no JIT
entitlement (scripting runs on JavaScriptCore's interpreter, which is the
sandbox posture we want), and the entitlements file `package_app.sh`
generates is deliberately empty.
