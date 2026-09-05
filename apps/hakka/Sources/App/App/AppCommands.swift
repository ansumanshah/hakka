import AppKit
import HakkaCore
import SwiftUI

/// New Request / Send / Save, wired straight to `AppModel` so the same
/// actions the toolbar buttons trigger are reachable from the menu bar.
struct AppCommands: Commands {
    /// `openWindow` is only available through the environment, and `Commands`
    /// can read it the same way a `View` does.
    @Environment(\.openWindow) private var openSourceControl

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
        // Sits beside Request/Traffic rather than under a generic View menu:
        // it acts on the open collection, which is what the Request menu's
        // neighbours do too.
        CommandMenu("Source Control") {
            Button("Show Source Control") { openSourceControl(id: WindowID.sourceControl) }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(model.collection.directoryURL == nil)
        }
        CommandMenu("Traffic") {
            Button("Focus Search") { model.traffic.focusSearchToken += 1 }
                .keyboardShortcut("f", modifiers: .command)
            Divider()
            Button("Clear Traffic") { Task { await model.traffic.clear() } }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(model.traffic.requests.isEmpty)
        }
        CommandGroup(replacing: .importExport) {
            Button("Open Session…") { Task { await model.importTrafficSession() } }
            Divider()
            Button("Export Session…") { Task { await model.exportTrafficSession() } }
                .disabled(model.traffic.requests.isEmpty)
            Button("Export as HAR…") { Task { await model.exportTrafficHar() } }
                .disabled(model.traffic.requests.isEmpty)
            Divider()
            Button("Compare Sessions…") { Task { await model.sessionCompare.compare() } }
            Divider()
            Button("Export Collection as OpenAPI…") {
                Self.saveCollectionExport(
                    OpenAPIExporter.export(model.collection.collection),
                    suggestedName: "\(model.collection.collection.name).openapi.json",
                    model: model,
                )
            }
            .disabled(model.collection.collection.nodes.isEmpty)
            Button("Export Collection as Postman Collection…") {
                Self.saveCollectionExport(
                    PostmanExporter.export(model.collection.collection),
                    suggestedName: "\(model.collection.collection.name).postman_collection.json",
                    model: model,
                )
            }
            .disabled(model.collection.collection.nodes.isEmpty)
        }
    }

    /// Writes an exported collection to a user-chosen file. A save panel
    /// here directly, not routed through `AppModel`, since neither exporter
    /// needs anything else `AppModel` owns.
    private static func saveCollectionExport(_ data: Data, suggestedName: String, model: AppModel) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.prompt = "Export"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try data.write(to: url, options: .atomic)
            model.collection.lastError = nil
        } catch {
            model.collection.lastError = "Export failed: \(error.localizedDescription)"
        }
    }
}
