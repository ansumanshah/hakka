# hakka-integrate-expo

Add Hakka to an Expo app with the config plugin and a development build. Expo Go does not include Hakka's native module.

## Steps

1. Install Hakka and the development client. No clipboard package, React Native UI peers, or worklets Babel plugin is required:

   ```sh
   npm install hakka-react-native
   npx expo install expo-dev-client
   ```

2. Register the config plugin:

   ```json
   {
     "expo": {
       "plugins": ["hakka-react-native"]
     }
   }
   ```

   The plugin adds Android debug/release network artifacts and the debug native inspector. Set `androidPerformance: true` in the plugin options to add performance collectors. iOS uses autolinking and CocoaPods.

3. Rebuild native layers:

   ```sh
   npx expo prebuild --clean
   npx expo run:ios
   npx expo run:android
   ```

4. Start capture once in the app entry point:

   ```ts
   import { Hakka } from 'hakka-react-native'
   Hakka.start({ mode: 'auto' })
   ```

5. Open the native inspector from an app action or debug menu:

   ```ts
   const didOpen = await Hakka.show({ as: 'sheet' })
   // Also supports 'bubble' and 'fullscreen'.
   Hakka.hide()
   ```

   No React wrapper is needed. Native UI requires native capture and returns `false` when unavailable, including JS-only capture.

6. Fire a test request in the development build and verify it appears in the native inspector.
