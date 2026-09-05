# hakka-integrate-ios

Add Hakka native network capture and the optional iOS inspector to a Swift app.

## Steps

1. Add the local Swift package at `ios/` from a Hakka checkout. Select `HakkaNetwork` and, for an iOS inspector, `HakkaUI`. Add `HakkaPerformance` only when needed. Follow the public iOS installation guide for distribution setup; the repository root is not the Swift package directory.

2. Start capture before the app's first network request:

   ```swift
   import HakkaNetwork

   HakkaInterceptor.shared.start()
   ```

3. Subscribe to captured requests when needed:

   ```swift
   HakkaInterceptor.shared.onRequest = { request in
       print(request.url)
   }
   ```

4. On the main actor, open the optional iOS inspector:

   ```swift
   import HakkaUI

   OverlayWindow.shared.show()
   // OverlayWindow.shared.hide() dismisses it.
   ```

   The inspector is presented by its native window controller; it is not an exported SwiftUI root view.

5. Trigger a URLSession request and verify it in `HakkaInterceptor.shared.store.requests`. Use `HakkaNetworkNoop` and `HakkaPerformanceNoop` for release targets that must not capture traffic. The inspector requires UIKit and is not a macOS SwiftUI view.

See `docs/src/content/docs/ios/` for configuration and privacy APIs. Verify current Swift signatures before adding custom configuration.
