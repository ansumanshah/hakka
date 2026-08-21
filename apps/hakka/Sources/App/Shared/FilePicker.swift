import AppKit

/// Shared "choose a file" prompt for the multipart and binary body editors.
/// Blocking `runModal()` is the standard AppKit idiom for a one-off picker
/// (see `AppModel.openCollectionDirectory` for the same pattern on a
/// directory), and it's fine to call from a plain button action — nothing
/// else needs to run while the panel is up.
@MainActor
enum FilePicker {
    static func chooseFile() -> String? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose"
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        return url.path
    }
}
