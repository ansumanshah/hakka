import AppKit
import HakkaCore
import Observation
import UniformTypeIdentifiers

/// Drives "diff two runs": picks two `.hakka-session` files, computes a
/// `SessionDiff`, and holds the result for `SessionCompareView`. Session
/// loading mirrors `AppModel+TrafficSessions`'s `importTrafficSession` (same
/// panel setup) but never touches the live `TrafficStore` — comparing two
/// saved runs must not disturb whatever is currently being captured.
@MainActor
@Observable
final class SessionCompareModel {
    private(set) var diff: SessionDiff?
    private(set) var beforeName: String?
    private(set) var afterName: String?
    var lastError: String?

    /// Walks the user through picking the "before" run, then the "after"
    /// run, then computes the diff. Cancelling either picker leaves the
    /// model untouched rather than showing a half-picked comparison.
    func compare() async {
        guard let before = await pickSession(message: "Choose the “before” run") else { return }
        guard let after = await pickSession(message: "Choose the “after” run") else { return }
        beforeName = before.name
        afterName = after.name
        diff = SessionDiff.diff(before: before, after: after)
        lastError = nil
    }

    func dismiss() {
        diff = nil
        beforeName = nil
        afterName = nil
    }

    func clearError() {
        lastError = nil
    }

    private func pickSession(message: String) async -> TrafficSession? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        panel.message = message
        // `.hakka-session` has no registered UTI — same dynamic-type derivation
        // `importTrafficSession` uses, for the same reason: a nil result just
        // means the picker doesn't filter, which is fine.
        if let type = UTType(filenameExtension: TrafficSession.fileExtension) {
            panel.allowedContentTypes = [type]
        }
        panel.prompt = "Choose"
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        guard let data = try? Data(contentsOf: url) else {
            lastError = "Could not read \(url.lastPathComponent)."
            return nil
        }
        do {
            return try TrafficSessionCodec.decode(data)
        } catch {
            lastError = "\(url.lastPathComponent) is not a readable session: \(error)"
            return nil
        }
    }
}
