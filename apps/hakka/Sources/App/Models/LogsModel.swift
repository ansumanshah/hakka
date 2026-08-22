import HakkaCommon
import HakkaServer
import Observation

/// The Logs surface's model: mirrors `BridgeHub.consoleEntries` into a
/// bounded, displayable list for the desktop Logs panel — the sibling of
/// `TrafficModel` for the `console` frame kind. A `console` frame's payload
/// is always a small batch (see `BridgeFrame.console`'s doc comment), so
/// each stream element is appended wholesale rather than one entry at a
/// time.
@MainActor
@Observable
final class LogsModel {
    private(set) var entries: [LogEntry] = []

    /// Ring-buffer cap so an app left open indefinitely doesn't grow this
    /// list without bound — mirrors `HakkaLogStore`'s own default capacity
    /// (500) on the SDK side, since this panel is showing the same kind of
    /// data at the same rough scale.
    static let capacity = 500

    /// Consumes `hub.consoleEntries` for the lifetime of the calling task —
    /// meant to be driven by a SwiftUI `.task` at the app root, alongside
    /// `TrafficModel.start()`, not spawned as a detached `Task`.
    func start(hub: BridgeHub) async {
        for await batch in hub.consoleEntries {
            entries.append(contentsOf: batch)
            if entries.count > Self.capacity {
                entries.removeFirst(entries.count - Self.capacity)
            }
        }
    }

    func clear() {
        entries = []
    }
}
