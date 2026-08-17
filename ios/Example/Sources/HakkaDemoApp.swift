import SwiftUI
import HakkaNetwork
import HakkaUI

@main
struct HakkaDemoApp: App {
    init() {
        HakkaInterceptor.shared.start()
        // Show the floating bubble on launch
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            BubbleWindow.shared.show()
        }
    }

    var body: some Scene {
        WindowGroup {
            DemoView()
        }
    }
}
