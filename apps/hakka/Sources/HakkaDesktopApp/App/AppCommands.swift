import SwiftUI

/// New Request / Send / Save, wired straight to `AppModel` so the same
/// actions the toolbar buttons trigger are reachable from the menu bar.
struct AppCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Request") { model.newRequest() }
                .keyboardShortcut("n", modifiers: .command)
        }
        CommandGroup(replacing: .saveItem) {
            Button("Save") { Task { await model.saveActiveRequest() } }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(!model.editor.isDirty)
        }
        CommandMenu("Request") {
            Button("Send") { Task { await model.sendActiveRequest() } }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(model.selection?.isRequest != true || model.editor.isSending)
        }
    }
}
