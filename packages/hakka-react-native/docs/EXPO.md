# Expo Development Builds

Hakka includes native Android and iOS code. Expo Go is not supported because the
Expo Go binary does not include Hakka's native module. Use Expo prebuild and a
development build instead.

## Install

Install Hakka and the required clipboard peer:

```bash
npm install hakka-react-native
npx expo install @react-native-clipboard/clipboard
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

The config plugin adds the Android debug/release Hakka network artifacts during
prebuild. Hakka does not require plist or manifest mutations today, and iOS
dependencies are handled by React Native autolinking and CocoaPods.

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

## Optional JS Inspector UI

Core capture does not require Hakka's JS inspector UI. If you use
`hakka-react-native/ui`, install the optional UI peers in the host Expo app:

```bash
npx expo install react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg react-native-worklets
```

Add the Worklets Babel plugin last in `babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true)

  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  }
}
```

If the app already has a Worklets or Reanimated setup, keep a single Worklets
plugin entry and keep it last.

## Capture Mode Caveat

Hakka defaults to `mode: 'auto'`, which prefers native capture when the Hakka
native module is present and falls back to JS interception only when native
capture is unavailable.

```ts
import { Hakka } from 'hakka-react-native'

Hakka.start({ mode: 'auto' })
```

Use `mode: 'native'` when you want a development build to fail fast if the native
module is missing. Use `mode: 'js'` only when you intentionally want JS
fetch/XHR/WebSocket interception; JS mode will not observe traffic made directly
by native SDKs.

## SDK 56 Native Internals

Expo SDK 56's Apple native-module improvements do not change Hakka's current
integration path. Hakka remains a standalone React Native package with a
TurboModule/codegen bridge over native Android and Swift SDKs. A direct
Swift-JSI layer is deferred until profiling shows Hakka needs high-frequency
sync calls, host objects, or array-buffer style access across the JS/native
boundary.
