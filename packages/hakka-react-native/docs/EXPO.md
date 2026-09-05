# Expo Development Builds

Hakka includes native Android and iOS code. Expo Go is not supported because the
Expo Go binary does not include Hakka's native module. Use Expo prebuild and a
development build instead.

## Install

Install Hakka:

```bash
npm install hakka-react-native
```

Install the development client for local Expo development builds:

```bash
npx expo install expo-dev-client
```

## App Config

Add Hakka to the Expo plugins array:

```json
{
  "expo": {
    "plugins": ["hakka-react-native"]
  }
}
```

The config plugin adds the Android debug/release Hakka network, performance, and
UI artifacts during prebuild when native SDK support is enabled. iOS dependencies,
including the canonical native UI, are handled by React Native autolinking and
CocoaPods. The native inspector is opened with `Hakka.show({ as: 'bubble' | 'sheet'
| 'fullscreen' })` after native capture starts.

```json
{
  "expo": {
    "plugins": [["hakka-react-native", {}]]
  }
}
```

The plugin entrypoint does not add an Expo runtime dependency for bare React
Native users.

To opt into native Android performance collectors during development builds,
enable the plugin option:

```json
{
  "expo": {
    "plugins": [["hakka-react-native", { "androidPerformance": true }]]
  }
}
```

By default, Android performance collectors remain opt-in so the base native
capture setup stays small.

## Prebuild And Run

Generate native projects when needed:

```bash
npx expo prebuild
```

After adding or updating Hakka, changing app config, or changing other native
dependencies, refresh the generated native projects and rebuild:

```bash
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

For day-to-day JS changes after a development build is installed:

```bash
npx expo start
```

If you build development clients with EAS, use a development profile and then
start Metro with `npx expo start`.

## Native Inspector

The React Native package no longer exports `hakka-react-native/ui` or bundles a
JS inspector and its UI-only peers. Capture, hooks, monitors, clipboard sharing,
WebView support, and Rozenite remain available programmatically.

## Native Capture

Native is the only capture mode and the default. Start capture without a mode:

```ts
import { Hakka } from 'hakka-react-native'

Hakka.start()
```

Startup throws if the native module is missing. Rebuild the development client
with Hakka linked; there is no JavaScript fallback. Use `Hakka.stop()` to stop capture.

## SDK 56 Native Internals

Expo SDK 56's Apple native-module improvements do not change Hakka's current
integration path. Hakka remains a standalone React Native package with a
TurboModule/codegen bridge over native Android and Swift SDKs. A direct
Swift-JSI layer is deferred until profiling shows Hakka needs high-frequency
sync calls, host objects, or array-buffer style access across the JS/native
boundary.

### Android inspector packaging

`androidUI` defaults to `true` and adds `hakka-ui` to debug builds. Set it to
`false` for capture without the in-app inspector. Release builds use the network
noop artifact and omit the UI; `androidPerformance: true` similarly selects the
real debug collector and release noop. The iOS inspector is included in the RN
pod. Use `await Hakka.show(...)` and check its boolean result.
