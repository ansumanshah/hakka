# hakka-integrate-react-native

Install Hakka in a React Native app, start capture, and open the native iOS or Android inspector.

## Steps

1. Install Hakka. No clipboard package, React Native UI peers, or worklets Babel plugin is required:

   ```sh
   bun add hakka-react-native
   ```

2. Install the native dependencies and rebuild the app:

   ```sh
   cd ios && pod install && cd ..
   ```

   For Android, configure the app-level native SDK artifacts following the React Native package guide, then rebuild. The bridge uses compile-only dependencies; native capture and inspector artifacts must be present in the host app.

3. Start capture once in the app entry point:

   ```ts
   import { Hakka } from 'hakka-react-native'
   Hakka.start({ mode: 'auto' })
   ```

   `auto` prefers native capture and falls back to JS capture when the native module is unavailable.

4. Open the native inspector from an app action or debug menu:

   ```ts
   const didOpen = await Hakka.show({ as: 'sheet' })
   // Also supports 'bubble' and 'fullscreen'.
   Hakka.hide()
   ```

   No React wrapper is needed. Native UI requires native capture and returns `false` when unavailable, including JS-only capture.

5. Fire a test request, open the inspector, and verify its method, URL, status, and timing. Confirm `Hakka.isActive` and inspect `Hakka.getLogs()` when debugging capture.
