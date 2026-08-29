# expo-example

Minimal Expo app exercising the `hakka-react-native` **config plugin**, the dedicated setup path
described in [docs/react-native/expo.mdx](../../../../docs/src/content/docs/react-native/expo.mdx).
Where [`../react-native-example`](../react-native-example) is a bare RN app that deliberately never
links native Hakka, this app links it through `app.json`'s `plugins` array and `expo prebuild`.

Expo Go cannot load this app: Hakka includes native code. You need a development build.

## Setup

```bash
bun install    # from the repo root
```

## Prebuild + run

```bash
cd packages/hakka-react-native/examples/expo-example
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

`expo prebuild` regenerates `ios/` and `android/` from `app.json`. They are gitignored here on
purpose, not committed, so a fresh clone always prebuilds against the current plugin. Prebuilding
runs the `hakka-react-native` plugin from `app.json`'s `plugins` array
(`packages/hakka-react-native/app.plugin.js`), which adds the Android debug/release Hakka artifacts
to the generated `android/app/build.gradle`:

```
debugImplementation("com.noodleapps.hakka:hakka-network:0.1.0")
releaseImplementation("com.noodleapps.hakka:hakka-network-noop:0.1.0")
```

iOS gets its native dependency through React Native autolinking and CocoaPods, no plugin work
needed there. To also opt in to the Android performance collectors, change `app.json`:

```json
"plugins": [["hakka-react-native", { "androidPerformance": true }]]
```

## Day-to-day development

Once the development build is installed, JS-only changes don't need a rebuild:

```bash
npx expo start
```

Rebuild (`npx expo run:ios` / `run:android`) only when native dependencies or plugin config change.

## Verify

Open the app, tap **Fire GET request** or **Fire failing request**, then **Open Hakka inspector**
(or shake the device / press `m` in the Expo CLI to open the dev menu). You should see the fired
requests in the inspector with method, status, and timing.

## Metro and optional peers

This example installs none of `hakka-react-native`'s optional peer dependencies (no
gesture-handler, reanimated, mmkv, async-storage, and so on; see
[`../../metro.js`](../../metro.js) for the full list). Those are `require()`d behind `try/catch` in
`src/`, which Metro cannot honor: it resolves `require('<literal>')` statically at bundle time,
before any of that guard code runs. Without help, an absent optional peer fails the whole bundle
with "Unable to resolve module ..." instead of degrading.

`metro.config.js` here wraps the Expo default config with `withHakka()` from
`hakka-react-native/metro`, which stubs exactly those module names to Metro's built-in empty module
when they're not installed, so the bundle succeeds and the existing runtime guards do the rest. If
you install every optional peer, `withHakka()` is a no-op: nothing is stubbed once everything
resolves for real.

Verify the bundle actually builds (same shape as `../react-native-example`'s `bundle` script):

```bash
bun run bundle
```

## What it covers

- The Expo config plugin contract: `app.json` plugin entry, `androidPerformance` opt-in,
  `expo prebuild`
- `withHakka()` from `hakka-react-native/metro`, required because this app skips every optional
  peer
- Core capture (`Hakka.start()`, `useNetworkLogs`) and `Hakka.show({ as: 'sheet' })` against a
  linked native module

## What it doesn't cover

- The `hakka-react-native/ui` overlay (`HakkaInspector.Wrapper`, bubble/shake-to-open UI). That
  needs the UI peers (`react-native-gesture-handler`, `react-native-reanimated`,
  `react-native-safe-area-context`, `react-native-svg`, `react-native-worklets`), which this
  example deliberately skips to keep the "no optional peers installed" Metro scenario real. See
  docs/react-native/expo.mdx's "Optional UI Peers" section for the install + Babel plugin steps if
  you want to add it here.
- WebView capture, WebSocket capture, mock rules, throttle profiles, HAR/Postman/OTel export.
  All of that is covered by `../react-native-example` instead. This app's only job is proving the
  Expo path.
