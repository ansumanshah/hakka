import SwiftUI

@main
struct HakkaApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(model)
                .frame(minWidth: 900, minHeight: 560)  // ui-token-check-ignore: window chrome
                .task {
                    // `AppDelegate` is constructed before `AppModel` exists
                    // (see its own doc comment), so the hand-off happens here.
                    appDelegate.pauseInbox = model.pauseInbox
                    // All three loops run for the scene's lifetime: the rules
                    // and pause mirrors are concurrent children so neither
                    // can starve the traffic stream (all three are infinite
                    // for-awaits).
                    async let mirrorRules: Void = model.rules.observe()
                    async let mirrorPauses: Void = model.pauseInbox.observe()
                    await model.traffic.start()
                    await mirrorRules
                    await mirrorPauses
                }
        }
        .defaultSize(width: 1240, height: 780)  // ui-token-check-ignore: window chrome
        .commands {
            AppCommands(model: model)
        }
    }
}
