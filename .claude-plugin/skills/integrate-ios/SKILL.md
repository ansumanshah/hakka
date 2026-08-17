# hakka-integrate-ios

Add Hakka network and performance monitoring to a native iOS or macOS Swift app using Swift Package Manager or CocoaPods, then configure the URLProtocol interceptor.

## Steps

1. **Swift Package Manager (recommended):** In Xcode, choose File → Add Package Dependencies and enter:

   ```
   https://github.com/ansumanshah/hakka
   ```

   The `Package.swift` is at `ios/Package.swift` in the repo root. Add these products to your target:
   - `HakkaCommon` — shared records, config, storage, and sinks
   - `HakkaNetwork` — required for capture
   - `HakkaUI` — optional, built-in SwiftUI inspector panel
   - `HakkaPerformance` — optional, CPU/memory/frame metrics

   For release/distribution targets use `HakkaNetworkNoop` and `HakkaPerformanceNoop` instead — same API, no-op at runtime.

   **CocoaPods alternative:**

   ```ruby
   pod 'Hakka'           # includes Network + Performance subspecs
   pod 'Hakka/UI'        # optional inspector panel
   pod 'Hakka/NetworkNoop'   # for release targets
   ```

2. Import and start the interceptor in your app entry point or `@main` App struct:

   ```swift
   import HakkaNetwork

   @main
   struct MyApp: App {
     init() {
       let config = HakkaConfig(maxRequests: 500, redactHeaders: ["authorization", "cookie"])
       HakkaInterceptor.shared.start(config: config)
     }
     // ...
   }
   ```

   Or using `URLProtocol` directly for UIKit apps (the interceptor registers itself via `URLProtocol`):

   ```swift
   HakkaInterceptor.shared.start()
   ```

3. (Optional) iOS-only privacy fields not available through the React Native SDK:

   ```swift
   let config = HakkaConfig(
     sensitiveQueryItems: ["token", "api_key"],
     sensitiveBodyFields: ["password", "ssn"]
   )
   ```

   These redact matching URL query parameter values and JSON body field values. Android does not yet support these fields.

4. (Optional) Subscribe to captured records:

   ```swift
   HakkaInterceptor.shared.onRequest = { record in
     // record is a ContractRecord — persist, display, or forward
   }
   ```

5. (Optional) Show the built-in UI panel (requires `HakkaUI` product):

   ```swift
   import HakkaUI
   // In a SwiftUI view:
   HakkaInspectorView()
   ```

6. Build and run. Trigger network traffic and confirm requests appear in `HakkaInterceptor.shared.logStore`. If requests are missing, ensure the interceptor is started before the first `URLSession` call.
