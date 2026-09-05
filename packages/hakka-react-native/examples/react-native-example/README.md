# react-native-example

Local dev harness for testing `hakka-react-native` against the native Android and iOS SDKs. This is
a **bare React Native app** (no Expo) with the optional native Hakka modules linked.

## Setup

```bash
bun install    # from the repo root
cd packages/hakka-react-native/examples/react-native-example/ios && pod install && cd -
```

The WebView capture demo (`WebViewCaptureScreen.tsx`) imports a built copy of `hakka-browser` from
`./assets/hakka-browser.global.json`. That file is gitignored and regenerated, not committed — a
`preios`/`preandroid`/`prestart` hook (`scripts/ensure-webview-asset.js`) writes a placeholder there
automatically so a fresh clone still bundles. To see the real WebView demo instead of the
placeholder message, build `hakka-browser` first and copy it in:

```bash
bun run --cwd packages/hakka-browser build   # from the repo root
bun run copy:hakka-browser                   # from this directory
```

## Run

From the repository root, via the justfile:

```bash
just dev-ios
just dev-android
```

From this directory, using this package's own scripts (`package.json`):

```bash
bun run ios
bun run android
```

`just dev-android` publishes the current Android artifacts to Maven Local before launching. When
running the package script directly, publish them first so Gradle does not reuse an older local
`0.0.1` artifact. There is no Expo CLI here; `npx expo run:ios`/`run:android` do not apply to this
app.

## Android minified validation

From the repository root, build the JS packages and publish the current Android SDK artifacts,
then assemble the minified example:

```bash
bun run build
cd android && ./gradlew publishToMavenLocal && cd -
cd packages/hakka-react-native/examples/react-native-example/android
./gradlew -PhakkaMinifyRelease=true :app:assembleRelease
```

## What it covers

- Capture mode switching: `native`, `js`, `auto`, and
  pause/resume via `enabled: false` (a separate flag from `mode`, not a fourth mode value)
- Native inspector presentation through `Hakka.show()` when native SDK artifacts are linked
- HAR/Postman/OTel export through the capture APIs
- Mock rules and throttle profiles (`mockEngine`, `ThrottleEngine`), seeded from the SDK tab —
  breakpoints are configured live in the Rules tab itself, not from app code
- WebSocket capture (a real `wss://` echo round trip) and GraphQL detection (a named query against
  a public GraphQL API)
- WebView traffic capture, bridged to the same desktop hub as the RN app itself
- Desktop streaming to Hakka on port 8989
- Localhost bridge traffic exclusion (self-capture prevention)

## What it doesn't cover

- **AsyncStorage / MMKV / TanStack Query monitors** (`hakka-react-native/monitors`:
  `useAsyncStorageMonitor`, `useMMKVMonitor`, `useQueryMonitor`, `useReactQueryDevTools`). These
  hooks are real and no-op safely when their optional peer dependency isn't installed, which is
  exactly this example's state today — none of `@react-native-async-storage/async-storage`,
  `react-native-mmkv`, or `@tanstack/react-query` are dependencies here. Wiring a live demo needs
  adding those packages (native linking for the first two) in a dedicated pass; import the hooks
  above directly in your own app once you have the matching library installed.
- **`store` mode** (`HakkaConfig.mode: 'store'` — a pure aggregator fed via `ingest()`/`update()`,
  no interceptors installed). Real, but there's no interceptor-driven traffic to demo it against
  here.

## Traffic sources

Demo requests hit public endpoints (`httpbin.org`, `httpstat.us`, a public GraphQL API, a public
WebSocket echo server) so there's real traffic to inspect without standing up a backend. Offline or
firewalled, every button still fires — Hakka captures the failed connection itself (DNS/TLS error,
timeout) as a request, which is exactly what the "Edge cases" section demonstrates on purpose. If
_every_ request in every section fails the same way, check your network connection rather than
assuming the SDK is broken.
