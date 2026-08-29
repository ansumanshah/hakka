# hakka-integrate-expo

Add Hakka to an Expo managed-workflow app using the config plugin — requires a development build (Expo Go is not supported), injects native Android artifacts at prebuild time, and configures capture mode.

## Steps

1. Install the package:

   ```sh
   npm install hakka-react-native
   ```

   Install clipboard peer and dev client via Expo's version-resolver:

   ```sh
   npx expo install @react-native-clipboard/clipboard expo-dev-client
   ```

2. Install UI peers via Expo's version-resolver:

   ```sh
   npx expo install react-native-gesture-handler react-native-reanimated react-native-safe-area-context react-native-svg react-native-worklets
   ```

3. Register the config plugin in `app.json` or `app.config.ts`:

   ```json
   {
     "plugins": [["hakka-react-native"]]
   }
   ```

   To also add Android performance monitoring:

   ```json
   {
     "plugins": [["hakka-react-native", { "androidPerformance": true }]]
   }
   ```

   The plugin injects `debugImplementation("com.noodleapps.hakka:hakka-network:0.0.1")` and `releaseImplementation("com.noodleapps.hakka:hakka-network-noop:0.0.1")` into the Android Gradle dependencies. iOS is handled by autolinking and CocoaPods with no extra config.

4. Add `react-native-worklets/plugin` as the **last** plugin in `babel.config.js`:

   ```js
   module.exports = function (api) {
     api.cache(true)
     return {
       presets: ['babel-preset-expo'],
       plugins: ['react-native-worklets/plugin'],
     }
   }
   ```

5. Rebuild native layers:

   ```sh
   npx expo prebuild --clean
   npx expo run:ios
   npx expo run:android
   ```

6. Initialize Hakka in your root component or `_layout.tsx`:

   ```ts
   import { Hakka } from 'hakka-react-native'
   Hakka.start({ mode: 'auto' })
   ```

7. Wrap with the inspector overlay:

   ```tsx
   import { HakkaInspector } from 'hakka-react-native/ui'

   export default function RootLayout() {
     return (
       <HakkaInspector.Wrapper mode="bubble">
         <Slot />
       </HakkaInspector.Wrapper>
     )
   }
   ```

8. Run the **development build** (not Expo Go — Hakka requires native code). Shake the device or call `Hakka.show({ as: 'sheet' })` to open the inspector.
