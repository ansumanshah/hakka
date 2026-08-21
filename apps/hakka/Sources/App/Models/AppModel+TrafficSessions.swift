import AppKit
import HakkaCore
import UniformTypeIdentifiers

/// Traffic session import/export — split out of `AppModel` itself purely to
/// keep that file under the line-count gate; these are still `AppModel`
/// actions, not a separate sub-model, since they only touch `traffic` and a
/// save/open panel.
@MainActor
extension AppModel {
    /// Writes the captured buffer to a `.hakka-session` file the user names.
    func exportTrafficSession() async {
        guard let data = await traffic.exportSession(named: "Capture") else {
            traffic.lastError = "Nothing to export."
            return
        }
        await writeToPanel(data: data, suggestedName: "capture.\(TrafficSession.fileExtension)")
    }

    /// HAR 1.2, for handing the capture to a tool that isn't Hakka.
    func exportTrafficHar() async {
        guard let data = await traffic.exportHar() else {
            traffic.lastError = "Nothing to export."
            return
        }
        await writeToPanel(data: data, suggestedName: "capture.har")
    }

    func importTrafficSession() async {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        // `.hakka-session` has no registered UTI, so derive a dynamic one from
        // the extension rather than reaching for the deprecated
        // `allowedFileTypes`. A nil result means the picker simply doesn't
        // filter, which is a better failure than refusing to open.
        if let type = UTType(filenameExtension: TrafficSession.fileExtension) {
            panel.allowedContentTypes = [type]
        }
        panel.prompt = "Open"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard let data = try? Data(contentsOf: url) else {
            traffic.lastError = "Could not read \(url.lastPathComponent)."
            return
        }
        traffic.lastError = await traffic.importSession(from: data)
    }

    fileprivate func writeToPanel(data: Data, suggestedName: String) async {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.prompt = "Export"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try data.write(to: url, options: .atomic)
            traffic.lastError = nil
        } catch {
            traffic.lastError = "Export failed: \(error.localizedDescription)"
        }
    }
}
