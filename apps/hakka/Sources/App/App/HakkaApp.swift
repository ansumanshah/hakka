import SwiftUI

@main
struct HakkaApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .frame(minWidth: 900, minHeight: 560)
                .task {
                    // Both loops run for the scene's lifetime: the rules
                    // mirror is a concurrent child so it can't starve the
                    // traffic stream (both are infinite for-awaits).
                    async let mirrorRules: Void = model.rules.observe()
                    await model.traffic.start()
                    await mirrorRules
                }
        }
        .defaultSize(width: 1240, height: 780)
        .commands {
            AppCommands(model: model)
        }
    }
}
