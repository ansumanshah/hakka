import HakkaCommon
import Testing
@testable import HakkaApp

/// `StorageModel.visibleStores` is where the store picker + key/value search
/// actually narrow the Storage panel's list — the sibling of
/// `TrafficModelNoiseScopeTests` for the Storage surface. Seeds state
/// directly via `setSnapshots` rather than a live `BridgeHub`, same
/// reasoning as `TrafficModelDeviceFilterTests`.
@Suite("StorageModel filtering")
@MainActor
struct StorageModelFilterTests {
    private func snapshot(store: String, entries: [String: String]) -> StorageSnapshot {
        StorageSnapshot(store: store, timestamp: 0, entries: entries)
    }

    private func seeded() -> StorageModel {
        let model = StorageModel()
        model.setSnapshots([
            snapshot(store: "defaults", entries: ["theme": "dark", "onboarded": "true"]),
            snapshot(store: "keychain-redacted", entries: ["authToken": "<redacted>"]),
            snapshot(store: "cookies", entries: ["session": "abc123"]),
        ])
        return model
    }

    @Test func noFilterReturnsEveryStore() {
        let model = seeded()
        #expect(model.visibleStores.map(\.store).sorted() == ["cookies", "defaults", "keychain-redacted"])
    }

    @Test func storeNamesListsEverySeenStoreSorted() {
        let model = seeded()
        #expect(model.storeNames == ["cookies", "defaults", "keychain-redacted"])
    }

    @Test func selectingAStoreScopesToItAlone() {
        let model = seeded()
        model.selectStore("defaults")
        #expect(model.visibleStores.map(\.store) == ["defaults"])
    }

    @Test func selectingTheSameStoreTwiceClearsTheFilter() {
        let model = seeded()
        model.selectStore("defaults")
        model.selectStore("defaults")
        #expect(model.selectedStore == nil)
        #expect(model.visibleStores.count == 3)
    }

    @Test func searchMatchesAKey() {
        let model = seeded()
        model.searchText = "theme"
        #expect(model.visibleStores.map(\.store) == ["defaults"])
        #expect(model.visibleStores.first?.entries.keys.sorted() == ["theme"])
    }

    @Test func searchMatchesAValue() {
        let model = seeded()
        model.searchText = "abc123"
        #expect(model.visibleStores.map(\.store) == ["cookies"])
    }

    @Test func searchOnlyKeepsMatchingEntriesWithinAStore() {
        let model = seeded()
        model.searchText = "dark"
        let defaults = model.visibleStores.first { $0.store == "defaults" }
        #expect(defaults?.entries.count == 1)
        #expect(defaults?.entries["theme"] == "dark")
    }

    @Test func storeAndSearchCombine() {
        let model = seeded()
        model.selectStore("cookies")
        model.searchText = "theme"
        #expect(model.visibleStores.isEmpty)
    }

    @Test func clearResetsSnapshotsAndSelection() {
        let model = seeded()
        model.selectStore("defaults")
        model.clear()
        #expect(model.stores.isEmpty)
        #expect(model.selectedStore == nil)
    }
}
