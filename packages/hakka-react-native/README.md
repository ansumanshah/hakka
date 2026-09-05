# hakka-react-native

Local-first network inspector for React Native. Captures HTTP traffic via native OkHttp/NSURLSession hooks or JS fetch/XHR/WebSocket interception, with the native iOS and Android inspector opened through the TypeScript API.

## Install

```bash
npm install hakka-react-native @react-native-clipboard/clipboard
cd ios && pod install
```

`@react-native-clipboard/clipboard` is an optional peer, recommended so Hakka's share/copy
actions work. Without it, copy falls back to `expo-clipboard` when present, and otherwise
reports failure while everything else keeps working — the SDK has no required native
dependencies beyond React Native itself.

## Quick Start

```ts
import { Hakka } from 'hakka-react-native'

Hakka.start({ mode: 'auto' })
```

## Capture Modes

| Mode         | Behavior                                                       |
| ------------ | -------------------------------------------------------------- |
| `'auto'`     | Native capture when available, JS fallback otherwise (default) |
| `'native'`   | Native only — fails fast if the native module is missing       |
| `'js'`       | JS intercept of fetch, XHR, WebSocket only                     |
| `'disabled'` | No capture                                                     |

```ts
Hakka.start({ mode: 'native' })
Hakka.start({ mode: 'js' })
```

Native capture observes traffic made through platform networking APIs. JS capture cannot see traffic made directly by native SDKs.

## Native Inspector Surface

The inspector is provided by the native iOS and Android SDKs. Open it from a debug menu, a
shake gesture, or another app action:

```ts
Hakka.start({ mode: 'native' })
const didOpen = await Hakka.show({ as: 'sheet' }) // 'bubble' | 'sheet' | 'fullscreen'
Hakka.hide()
```

`Hakka.show()` resolves to a `boolean` after native presentation. It resolves `false` when the
native module or native UI artifact is unavailable. Native UI requires native or auto native
capture and is unavailable in `js`, `store`, or stopped mode.

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
npx expo install @react-native-clipboard/clipboard expo-dev-client
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
