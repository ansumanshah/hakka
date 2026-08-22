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
                    // All five loops run for the scene's lifetime: the rules,
                    // pause, logs, and storage mirrors are concurrent
                    // children so none can starve the traffic stream (all
                    // five are infinite for-awaits). `logs`/`storage` read
                    // the hub off `traffic.server` — a stored `let` on the
                    // `BridgeServer` actor, populated at init regardless of
                    // whether `start()` has run yet, so this needs no
                    // ordering relative to `model.traffic.start()` below.
                    async let mirrorRules: Void = model.rules.observe()
                    async let mirrorPauses: Void = model.pauseInbox.observe()
                    async let mirrorLogs: Void = model.logs.start(hub: await model.traffic.server.hub)
                    async let mirrorStorage: Void = model.storage.start(hub: await model.traffic.server.hub)
                    await model.traffic.start()
                    await mirrorRules
                    await mirrorPauses
                    await mirrorLogs
                    await mirrorStorage
                }
        }
        .defaultSize(width: 1240, height: 780)  // ui-token-check-ignore: window chrome
        .commands {
            AppCommands(model: model)
        }
    }
}
