import HakkaCommon
import HakkaServer
import Observation

/// The Logs surface's model: mirrors `BridgeHub.consoleEntries` into a
/// bounded, displayable list for the desktop Logs panel — the sibling of
/// `TrafficModel` for the `console` frame kind. A `console` frame's payload
/// is always a small batch (see `BridgeFrame.console`'s doc comment), so
/// each stream element is appended wholesale rather than one entry at a
/// time.
///
/// No per-device filter here: unlike `.request` frames (paired with sender
/// identity at ingest into `CapturedRequest`, see `TrafficModel.deviceIndex`),
/// `BridgeHub.ingest` yields `.console` frames on `consoleEntries` with no
/// peer pairing at all — `LogEntry` itself carries no device field, and the
/// hub never attributes one. There is nothing honest to filter by until that
/// wire-level gap closes; adding a filter control today would offer a lens
/// onto identity the data doesn't have.
@MainActor
@Observable
final class LogsModel {
    private(set) var entries: [LogEntry] = []

    /// Ring-buffer cap so an app left open indefinitely doesn't grow this
    /// list without bound — mirrors `HakkaLogStore`'s own default capacity
    /// (500) on the SDK side, since this panel is showing the same kind of
    /// data at the same rough scale.
    static let capacity = 500

    /// Raw search-bar text — matches `entry.message`, `entry.category`, and
    /// every key/value in `entry.metadata`, case-insensitively. Kept as a
    /// stored property (not view `@State`) so the search field survives a
    /// tab switch, same reasoning as `TrafficModel.searchText`.
    var searchText = ""

    /// The active level chip, nil for "All" — the Logs filter bar's
    /// counterpart to the mobile inspectors' Console/Structured level chips
    /// (`ios/Sources/UI/Logs/LogsView.swift`'s `levelFilter`).
    var levelFilter: LogLevel?

    /// `entries` narrowed by `levelFilter` then `searchText` — the list the
    /// panel actually renders. A pure function of stored state so it's
    /// exercised directly by `LogsModelFilterTests` without any view.
    var filteredEntries: [LogEntry] {
        var matched = levelFilter.map { level in entries.filter { $0.level == level } } ?? entries
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return matched }
        matched = matched.filter { matches($0, query: query) }
        return matched
    }

    private func matches(_ entry: LogEntry, query: String) -> Bool {
        if entry.message.lowercased().contains(query) { return true }
        if let category = entry.category, category.lowercased().contains(query) { return true }
        guard let metadata = entry.metadata else { return false }
        return metadata.contains { key, value in
            key.lowercased().contains(query) || value.lowercased().contains(query)
        }
    }

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

    /// Test-only seam: `start(hub:)` needs a live `BridgeHub`, so
    /// `LogsModelFilterTests` seeds the buffer directly instead — same shape
    /// as `TrafficModel.setBuffer`.
    func setEntries(_ entries: [LogEntry]) {
        self.entries = entries
    }
}
