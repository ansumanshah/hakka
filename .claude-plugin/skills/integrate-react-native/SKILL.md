# hakka-integrate-react-native

Install and configure Hakka network inspector in a React Native app — installs the package, starts capture, adds the UI overlay, and verifies that requests appear in the inspector.

## Steps

1. Install the package and required clipboard peer:

   ```sh
   bun add hakka-react-native @react-native-clipboard/clipboard
   ```

   Install UI peers (skip any already present):

   ```sh
   bun add react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg react-native-worklets
   ```

2. Rebuild iOS native layer:

   ```sh
   cd ios && pod install && cd ..
   ```

   Then relaunch the app from Xcode or `bun run ios`.

3. Add the worklets Babel plugin as the **last** entry in your `babel.config.js` `plugins` array:

   ```js
   plugins: ['react-native-worklets/plugin']
   ```

4. Import and start capture in your app entry point (e.g. `App.tsx`):

   ```ts
   import { Hakka } from 'hakka-react-native'
   Hakka.start({ mode: 'auto' })
   ```

   `'auto'` prefers the native OkHttp/URLProtocol interceptor and falls back to JS-layer patching if the native module is unavailable.

5. Wrap the root component with the inspector overlay:

   ```tsx
   import { HakkaInspector } from 'hakka-react-native/ui'

   export default function App() {
     return (
       <HakkaInspector.Wrapper mode="bubble">
         <YourRootComponent />
       </HakkaInspector.Wrapper>
     )
   }
   ```

6. Fire a test network request in your app, then shake the device or call `Hakka.show({ as: 'sheet' })` — the inspector should list the captured request with method, URL, status, and timing.

7. Verify capture is active:
   ```ts
   console.log(Hakka.isActive) // true
   console.log(Hakka.getLogs()) // NetworkRecord[]
   ```
