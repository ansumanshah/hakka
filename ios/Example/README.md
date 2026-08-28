# Hakka — iOS demo app

**One button per Hakka feature — mock rule types, throttle profiles, breakpoints, WebSocket
frames, GraphQL detection, structured logs, and more — all captured live in the on-device
inspector.**

`HakkaDemoApp` is a small SwiftUI app that consumes `ios/Package.swift` as a local Swift
Package (`HakkaUI` + `HakkaNetwork`, which pull in `HakkaCommon`/`HakkaPerformance`
transitively) the same way any host app would. It exists to give the SDK's own UI (the
floating bubble, the inspector sheet, Rules, Logs, Storage) real traffic and real state to
show, and it's what CI's `ios-demo-app` job compiles on every push to catch drift `swift
build`/`swift test` can't see — see [Why this app exists](#why-this-app-exists) below.

## Run it

```bash
cd ios/Example
make run     # build, boot a simulator, install, launch — the fast loop (test.sh)
make open    # open HakkaDemoApp.xcodeproj in Xcode instead
make build   # compile only, no simulator boot/launch
make clean   # wipe this app's DerivedData
```

`make run` auto-picks a booted iPhone simulator, falling back to the first available one.
Override with `SIM_ID=<udid>` if you want a specific device.

From the repo root, `just build-ios-demo` runs the exact `xcodebuild` invocation CI's
`ios-demo-app` job runs (`.github/workflows/ci.yml`) — compile-only, no simulator, the
fastest way to confirm nothing broke:

```bash
just build-ios-demo
```

## What's on screen

Four sections of chrome (hero, live strip, feature shelf, a segmented picker), then one of
five scenario tabs. Every button fires real `URLSession` traffic or calls straight into a
Hakka SDK API — nothing here is scripted or faked for the screenshot.

### Overview

**Monitor Views** — the four ways to look at captured traffic: **Show HUD** (the floating
bubble), **Inspector** (the sheet), **Dashboard** (the performance monitor), **Full Screen**.
Below that, **Recent Activity** mirrors the last 5 scenario results locally, independent of
whatever the Inspector itself shows.

### Network

**Methods** (GET/POST/PUT/PATCH/DELETE/HEAD), **Payloads** (JSON, auth headers + cookies,
an image, a 100KB body), **Status Codes** (200/204/302/404/429/500), **Failures + Timing**
(a fast baseline, a 1s delay, a DNS failure, a TLS failure). All hit `httpbin.org` /
`httpstat.us` / deliberately-broken hosts — you need real network connectivity for this tab
and most of what follows.

### Performance

**Send 20**, four 100KB bodies back to back, a mixed-latency burst, and a 50-request burst —
enough volume to give the Dashboard's FPS/latency HUD something to plot.

### Mocks

**Mock Engine** — the plain canned-response mock (`MockResponse`) that was already here.
**Mock Types** — the other four `MockRuleInput` shapes iOS ships (confirmed against
`ios/Sources/Common/MockRuleTypes.swift` and `MockFailure.swift` before wiring these):

| Button      | `MockRuleInput` field        | What it shows                                                                                     |
| ----------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Block       | `block: true`                | Short-circuits with a network-error-shaped failure before the request is sent.                    |
| Redirect    | `redirectTo:`                | Passthrough-then-transform: the real request goes out, just to a different URL.                   |
| Modify      | `modify:` (`MockRuleModify`) | Real request/response, with headers set, status overridden, and a body find/replace applied.      |
| Failure     | `failure:` (`MockFailure`)   | Simulates a specific transport error (`.timeout`) — never a real response at all.                 |
| Skip + Stop | `skipCount:`/`stopAfter:`    | Fires the same URL 4×: request 1 passes through for real, 2–3 are mocked, 4 passes through again. |

Open **Rules > Mocks** in the Inspector after tapping any of these — each rule shows its hit
count, and "Modify"/"Redirect" show `isRewrite: true`. **Suites** batches Network/Performance
scenarios for a quick release smoke check.

### Advanced

Everything that used to have no demo action at all:

| Section           | Buttons                                  | What it shows                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Throttle Profiles | Fast 3G, Slow 3G, Edge, Offline, Reset   | Sets a named `ThrottleEngine` profile, then fires a request so the injected latency shows up in that request's own Timeline. The profile stays active for every request after it, like the real Rules > Throttle screen — tap Reset when you're done.                                                                                                                          |
| Breakpoints       | Arm + Trigger, Release All               | Arms a `.both`-phase `BreakpointEngine` rule and fires the matching request — it pauses twice (request phase, then response phase, since `HakkaURLProtocol` checks each independently), blocking that request's background thread on a semaphore each time, until you open **Rules > Breakpoints** and tap Resume or Abort. "Release All" is a safety net if you'd rather not. |
| Storage           | Seed, Clear                              | Writes/removes a handful of `UserDefaults.standard` keys (`hakkaDemo.*`) so the **Storage** tab has something real to show — it polls `UserDefaults.standard` directly.                                                                                                                                                                                                        |
| Logs              | Console, Structured                      | **Console** emits 4 lines at each `HakkaConsole` level; **Structured** emits one `HakkaInterceptor.log(...)` entry with category + metadata. These are two distinct stores — Console/Structured are the two segments inside the **Logs** tab.                                                                                                                                  |
| Protocol Coverage | WebSocket Echo, GraphQL Query, Gzip Body | See below.                                                                                                                                                                                                                                                                                                                                                                     |

- **WebSocket Echo** opens a real `URLSessionWebSocketTask` to a public echo server, sends
  one text frame, waits for the echo, then closes — `HakkaWebSocketMonitor` (installed via
  `HakkaInterceptor.shared.enableNativeWebSocket()` in `HakkaDemoApp.init()`) captures both
  frames and emits one request row with a **Frames** tab when the connection closes.
- **GraphQL Query** POSTs a named query + variables to a URL containing "graphql". No special
  wiring needed beyond that — `extractGraphQLOperationName` (`Network/Redaction.swift`) runs
  on every capture automatically, and the **GraphQL** detail tab only appears once it found an
  operation name.
- **Gzip Body** adds a mock rule whose response carries `Content-Encoding: gzip` and a real
  gzip-framed body (built on-device with Apple's Compression framework — see
  `DemoGzip.swift`), then fires a request at it. This goes through the mock engine rather than
  a live `httpbin.org/gzip` call on purpose: `URLSession` negotiates gzip and decompresses it
  transparently before Hakka ever sees the bytes, so a real network gzip response never
  reaches — and never exercises — the SDK's own `GzipBodyDecoder`.

### Shake to open

Shake the device (or **Cmd+Ctrl+Z** in Simulator) to open the inspector without touching any
button — wired via `enableHakkaShakeDetection()` on the key window in `HakkaDemoApp.init()`.
This is opt-in per `UIWindow`; a host app that wants it has to call the same thing.

### Exporting a request

Not a button on this screen — it's a per-request action inside the Inspector itself. Open any
captured row, go to the **Response** tab, and use the share icon: HAR, OTel, cURL, and a
Postman collection are all offered from that one action (`ReportHelper.buildShareItems`).

## Work through it once

1. Tap **Inspector** (hero row). It opens to the Network tab, empty.
2. Switch to **Network**, tap **GET**, **POST**, **500** — watch rows land live while the
   sheet is open.
3. Open one of those rows, go to **Response**, tap the share icon — HAR/OTel/cURL/Postman are
   all there.
4. Switch to **Mocks**, tap **Redirect**, then **Modify**, then **Failure** — each adds a rule
   and immediately fires the request that exercises it. Open **Rules > Mocks** and check the
   hit counts.
5. Tap **Skip + Stop** — it fires the same URL four times. Look at the row list: pass, mock,
   mock, pass.
6. Switch to **Advanced**, tap **Slow 3G**, open the request it fires, check the **Timeline**
   tab for the added latency.
7. Tap **Arm + Trigger** under Breakpoints, then open **Rules > Breakpoints** — the paused
   request is sitting there waiting on you. Resume it once and it pauses again on the
   response phase, before you ever see its status or body.
8. Tap **WebSocket Echo**, then **GraphQL Query**, then **Gzip Body**. Open each row: a
   **Frames** tab with the sent/received text, a **GraphQL** tab with the parsed operation +
   variables, and a **Response** tab already gunzipped.
9. Tap **Console**, then **Structured**, then check the **Logs** tab's two segments.
10. Tap **Seed** under Storage, then open the **Storage** tab.

## The whole integration

```swift
// HakkaDemoApp.swift
init() {
    HakkaInterceptor.shared.start()
    HakkaInterceptor.shared.enableNativeWebSocket()   // opt-in, see Advanced tab above
    BubbleWindow.shared.show()                        // the floating HUD
    window.enableHakkaShakeDetection()                 // opt-in per UIWindow
}
```

Everything past that is this file's own demo buttons calling straight into `HakkaCommon` /
`HakkaNetwork` / `HakkaUI` — `MockEngine.shared`, `ThrottleEngine.shared`,
`BreakpointEngine.shared`, `HakkaConsole.shared`, all singletons a real host app would reach
for the same way.

## Source layout

The scenario buttons used to live in one 630-line `DemoView.swift`. They're split by tab now,
each an `extension DemoView` in its own file (the same "split into extensions, not classes"
convention `ios/Sources` itself uses to stay under ~200 lines/file — see e.g.
`MockEngine.swift`/`MockEngineMatching.swift`):

| File                          | Contents                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `HakkaDemoApp.swift`          | App entry point — interceptor start, WebSocket capture opt-in, shake-to-open |
| `DemoView.swift`              | Root layout: hero, live strip, feature shelf, scenario picker/dispatch       |
| `DemoTheme.swift`             | Background gradient, glass chrome, `DemoPalette` color tokens                |
| `DemoComponents.swift`        | Reusable button/card view builders, `DemoEvent`                              |
| `DemoCore.swift`              | `fire`/`fireAuth`/`pushEvent`/`clearCapture` — shared by every tab           |
| `DemoNetworkScenarios.swift`  | Network + Performance tabs                                                   |
| `DemoMockScenarios.swift`     | Mocks tab — all five `MockRuleInput` shapes                                  |
| `DemoAdvancedScenarios.swift` | Throttle, Breakpoints, Storage, Logs, GraphQL, gzip                          |
| `DemoWebSocket.swift`         | The WebSocket Echo action                                                    |
| `DemoGzip.swift`              | Builds the gzip demo body                                                    |

`@State` on `DemoView` is intentionally not `private`: Swift's `private` is file-scoped even
across extensions of the same type, and these tabs live in other files now.

## Colors

`demoBackground`'s gradient uses `DemoPalette` (`DemoTheme.swift`), hex-for-hex the same as
`design-tokens.json`'s `dark.background`/`dark.surface`/`dark.surfaceRaised`/`dark.accent` —
the same source `scripts/sync-design-tokens.mjs` generates
`ios/Sources/UI/ThemeTokens.generated.swift`'s `HakkaTokens` enum from. It's a hand-kept copy,
not a reference to `HakkaTokens` itself: that enum is `internal` to the `HakkaUI` module (see
its own doc comment — only `HakkaMetrics`, the geometry enum, is `public`), so a separate
module like this Example app can't import it. The per-button tint colors elsewhere
(`.green`/`.mint`/`.purple`/…) are plain SwiftUI system colors used to keep 30+ buttons across
5 tabs visually distinct — there's no design token for "the redirect button" to prefer.

## Why this app exists

Not a substitute for `swift build`/`swift test` — a different failure class entirely.
`swift build` targets macOS and skips every `#if canImport(UIKit)` body outright, so a bug in
`HakkaUI`'s actual iOS surface ships invisibly without this app. And unlike `swift build`,
which resolves `ios/Sources` as separate library targets, this app compiles them into one
flattened target the way a real host app's dependency graph does — where a transitive
re-export from another module doesn't apply and Swift's access-level rules bite differently.
Both classes have reached CI green-locally before this app (and `just build-ios-sim`, its
sibling for `#if canImport(UIKit)` type-checking) existed to catch them; see the comments on
`build-ios-demo`/`build-ios-sim` in the repo-root `justfile`.
