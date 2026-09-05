# hakka-react-native

Local-first network inspector for React Native. Captures HTTP traffic via native OkHttp/NSURLSession hooks, with the native iOS and Android inspector opened through the TypeScript API.

## Install

```bash
npm install hakka-react-native
cd ios && pod install
```

No clipboard package or React Native UI peer is required. The native inspector uses
the platform clipboard directly. Only the optional JavaScript `copyToClipboard` and
`useShakeToShare` helpers need `@react-native-clipboard/clipboard` or `expo-clipboard`
for their clipboard-copy step.

## Quick Start

```ts
import { Hakka } from 'hakka-react-native'

Hakka.start()
```

## Native Capture

Native is the only capture mode and the default. `Hakka.start()` is equivalent to
`Hakka.start({ mode: 'native' })`. It throws if the native module is missing; rebuild
your app after installing Hakka. There is no JavaScript fallback.

Use `Hakka.stop()` or `Hakka.configure({ enabled: false })` to disable capture.

## Native Inspector Surface

The inspector is provided by the native iOS and Android SDKs. Open it from a debug menu, a
shake gesture, or another app action:

```ts
Hakka.start()
const didOpen = await Hakka.show({ as: 'sheet' }) // 'bubble' | 'sheet' | 'fullscreen'
Hakka.hide()
```

`Hakka.show()` resolves to a `boolean` after native presentation. It resolves `false` when the
native module or native UI artifact is unavailable. Native UI requires native
capture and is unavailable while capture is stopped.

The package no longer exports `hakka-react-native/ui`, and it no longer brings the JS inspector,
theme, renderer plugin, or their UI-only peers into an app. Session APIs, hooks, capture,
clipboard shake-to-share, WebView support, storage and query monitors, and Rozenite remain
available programmatically when the native surface does not expose a matching control.

## Optional Monitors

```tsx
import { useAsyncStorageMonitor, useQueryMonitor } from 'hakka-react-native/monitors'

function Monitors() {
  useAsyncStorageMonitor()
  useQueryMonitor([['todos']], queryClient)
  return null
}
```

Available monitors: AsyncStorage, TanStack Query (react-query), MMKV.

## Expo

Expo Go is not supported. Use a development build:

```bash
npm install hakka-react-native
npx expo install expo-dev-client
```

Add the config plugin:

```json
{
  "expo": {
    "plugins": ["hakka-react-native"]
  }
}
```

Rebuild native projects:

```bash
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

## Docs

Full documentation at **[hakka.noodleapps.com](https://hakka.noodleapps.com)** — install guides, capture mode reference, Expo setup, Android/iOS native SDK, and architecture notes.
