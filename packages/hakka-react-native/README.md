# hakka-react-native

Local-first network inspector for React Native. Captures HTTP traffic via native OkHttp/NSURLSession hooks or JS fetch/XHR/WebSocket interception, with an optional in-app inspector UI.

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

Optional in-app inspector UI (install UI peers first — see below):

```tsx
import { HakkaInspector } from 'hakka-react-native/ui'

export function App() {
  return (
    <HakkaInspector.Wrapper mode="bubble">
      <YourApp />
    </HakkaInspector.Wrapper>
  )
}
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

## Optional Inspector UI

The UI is behind `hakka-react-native/ui` and tree-shaken when unused. Install peers only if you import it:

```bash
npm install react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg react-native-worklets
```

Add `react-native-worklets/plugin` last in `babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  }
}
```

## Native Inspector Surface

When native UI artifacts are linked, open native surfaces without bundling the JS inspector:

```ts
Hakka.show({ as: 'sheet' }) // iOS sheet / Android bottom sheet
Hakka.show({ as: 'bubble' }) // floating bubble
Hakka.show({ as: 'fullscreen' }) // fullscreen inspector
```

`Hakka.show()` returns a `boolean` — `false` when the native module isn't linked at
all, or when the TurboModule is present but the optional native UI package
(`HakkaUI` on iOS, `hakka-ui` on Android) isn't on the classpath. Check the return
value if you need to react to "no native UI available" instead of assuming it
opened.

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
