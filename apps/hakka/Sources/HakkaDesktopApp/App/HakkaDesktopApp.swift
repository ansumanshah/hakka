import SwiftUI

@main
struct HakkaDesktopApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .frame(minWidth: 900, minHeight: 560)
                .task { await model.traffic.start() }
        }
        .defaultSize(width: 1240, height: 780)
        .commands {
            AppCommands(model: model)
        }
    }
}
