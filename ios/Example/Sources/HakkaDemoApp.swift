import SwiftUI
import UIKit
import HakkaNetwork
import HakkaUI

@main
struct HakkaDemoApp: App {
    init() {
        HakkaInterceptor.shared.start()
        // WebSocket capture is opt-in (it installs a URLSession swizzle) --
        // enable it up front so the Advanced tab's WebSocket Echo demo is
        // captured on the very first tap, not just after some other call
        // site happens to enable it first.
        HakkaInterceptor.shared.enableNativeWebSocket()

        // Show the floating bubble on launch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            BubbleWindow.shared.show()
            Self.enableShakeToOpen()
        }
    }

    var body: some Scene {
        WindowGroup {
            DemoView()
        }
    }

    /// Shake-to-open is opt-in per `UIWindow`
    /// (`ShakeWindow.swift`'s `enableHakkaShakeDetection()`), not automatic --
    /// grab the key window once the scene has one and wire it up. Works on a
    /// real device via CoreMotion; in Simulator, shake with Cmd+Ctrl+Z.
    private static func enableShakeToOpen() {
        let window = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first
        window?.enableHakkaShakeDetection()
    }
}
