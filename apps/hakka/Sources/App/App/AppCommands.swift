import AppKit
import HakkaCore
import SwiftUI

/// New Request / Send / Save, wired straight to `AppModel` so the same
/// actions the toolbar buttons trigger are reachable from the menu bar.
struct AppCommands: Commands {
    let model: AppModel

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Request") { model.newRequest() }
                .keyboardShortcut("n", modifiers: .command)
            Button("Open Collection…") { Task { await model.openCollectionDirectory() } }
                .keyboardShortcut("o", modifiers: .command)
        }
        CommandGroup(replacing: .saveItem) {
            Button("Save") { Task { await model.saveActiveRequest() } }
                .keyboardShortcut("s", modifiers: .command)
                .disabled(model.editor.draft == nil || (!model.editor.isDirty && model.collection.directoryURL != nil))
        }
        CommandMenu("Request") {
            Button("Next Request Tab") { model.cycleRequestTab(forward: true) }
                .keyboardShortcut(.tab, modifiers: .control)
                .disabled(model.requestWorkspaceTabs.openRequestIDs.count < 2)
            Button("Previous Request Tab") { model.cycleRequestTab(forward: false) }
                .keyboardShortcut(.tab, modifiers: [.control, .shift])
                .disabled(model.requestWorkspaceTabs.openRequestIDs.count < 2)
            Divider()
            Button("Send") { Task { await model.sendActiveRequest() } }
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(model.selection?.isRequest != true || model.editor.isSending)
        }
        // Sits beside Request/Traffic rather than under a generic View menu:
        // it acts on the open collection, which is what the Request menu's
        // neighbours do too.
        CommandMenu("Source Control") {
            Button("Show Source Control") { model.select(.changes) }
                .keyboardShortcut("g", modifiers: [.command, .shift])
                .disabled(model.collection.directoryURL == nil)
        }
        CommandMenu("Traffic") {
            Button("Proxy Capture…") { model.select(.proxy) }
                .keyboardShortcut("p", modifiers: [.command, .shift])
            Divider()
            Button("Focus Search") { model.traffic.focusSearchToken += 1 }
                .keyboardShortcut("f", modifiers: .command)
            Divider()
            Button("Clear Traffic") { Task { await model.traffic.clear() } }
                .keyboardShortcut("k", modifiers: .command)
                .disabled(model.selection != .traffic || model.traffic.requests.isEmpty)
        }
        CommandMenu("Inspector") {
            Button("Show Inspector") {
                UserDefaults.standard.set(true, forKey: InspectorPlacement.visibilityKey)
            }
            Button("Hide Inspector") {
                UserDefaults.standard.set(false, forKey: InspectorPlacement.visibilityKey)
            }
            Divider()
            Button("Place Inspector on Right") {
                UserDefaults.standard.set(InspectorPlacement.trailing.rawValue, forKey: InspectorPlacement.placementKey)
                UserDefaults.standard.set(true, forKey: InspectorPlacement.visibilityKey)
            }
            .keyboardShortcut("i", modifiers: [.command, .shift])
            Button("Place Inspector on Bottom") {
                UserDefaults.standard.set(InspectorPlacement.bottom.rawValue, forKey: InspectorPlacement.placementKey)
                UserDefaults.standard.set(true, forKey: InspectorPlacement.visibilityKey)
            }
            .keyboardShortcut("i", modifiers: [.command, .option])
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
