import HakkaCommon
import Testing
@testable import HakkaApp

/// `LogsModel.filteredEntries` is where search + level filtering actually
/// narrows the Logs panel's list — the sibling of
/// `TrafficModelNoiseScopeTests` for the Logs surface. Seeds state directly
/// via `setEntries` rather than a live `BridgeHub`, same reasoning as
/// `TrafficModelDeviceFilterTests`.
@Suite("LogsModel filtering")
@MainActor
struct LogsModelFilterTests {
    private func entry(
        id: String,
        level: LogLevel,
        message: String,
        category: String? = nil,
        metadata: [String: String]? = nil
    ) -> LogEntry {
        LogEntry(id: id, timestamp: 0, level: level, message: message, category: category, metadata: metadata)
    }

    private func seeded() -> LogsModel {
        let model = LogsModel()
        model.setEntries([
            entry(id: "a", level: .info, message: "User authenticated", category: "auth"),
            entry(id: "b", level: .warn, message: "Network timeout after 30s", category: "network"),
            entry(id: "c", level: .error, message: "Failed to load image", metadata: ["url": "https://example.com/a.png"]),
        ])
        return model
    }

    @Test func noFilterReturnsEveryEntry() {
        let model = seeded()
        #expect(model.filteredEntries.map(\.id) == ["a", "b", "c"])
    }

    @Test func levelFilterKeepsOnlyThatLevel() {
        let model = seeded()
        model.levelFilter = .warn
        #expect(model.filteredEntries.map(\.id) == ["b"])
    }

    @Test func searchMatchesMessage() {
        let model = seeded()
        model.searchText = "timeout"
        #expect(model.filteredEntries.map(\.id) == ["b"])
    }

    @Test func searchMatchesCategory() {
        let model = seeded()
        model.searchText = "auth"
        #expect(model.filteredEntries.map(\.id) == ["a"])
    }

    @Test func searchMatchesMetadataValue() {
        let model = seeded()
        model.searchText = "example.com"
        #expect(model.filteredEntries.map(\.id) == ["c"])
    }

    @Test func searchIsCaseInsensitive() {
        let model = seeded()
        model.searchText = "FAILED"
        #expect(model.filteredEntries.map(\.id) == ["c"])
    }

    @Test func levelAndSearchCombine() {
        let model = seeded()
        model.levelFilter = .error
        model.searchText = "network"
        #expect(model.filteredEntries.isEmpty)
    }

    @Test func clearEmptiesTheBufferButLeavesFiltersAlone() {
        let model = seeded()
        model.levelFilter = .warn
        model.clear()
        #expect(model.entries.isEmpty)
        #expect(model.filteredEntries.isEmpty)
        #expect(model.levelFilter == .warn)
    }
}
