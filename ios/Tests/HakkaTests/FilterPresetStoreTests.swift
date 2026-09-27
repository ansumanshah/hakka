#if canImport(UIKit)
import Foundation
import Testing
@testable import HakkaUI

@Suite("Filter presets")
struct FilterPresetStoreTests {
    @Test @MainActor
    func savedDomainFiltersSurvivePersistenceAndOldEntriesDecode() {
        let suiteName = "hakka.filter-presets.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let preset = FilterPreset(
            searchQuery: "url:api",
            methodFilters: ["GET"],
            domainFilters: ["api.example.com", "cdn.example.com"],
            statusGroup: "2xx",
            sortField: .time,
            sortAscending: false,
            groupBy: .host
        )
        let store = FilterPresetStore(defaults: defaults)
        store.save(name: "APIs", preset: preset)
        store.pushRecent(preset)
        #expect(FilterPresetStore(defaults: defaults).recent == [preset])

        let restored = FilterPresetStore(defaults: defaults).saved.first?.preset
        #expect(restored == preset)
        store.save(name: "Copy", preset: preset)
        store.remove(name: "APIs")
        #expect(FilterPresetStore(defaults: defaults).saved.map(\.name) == ["Copy"])
        store.remove(name: "Copy")
        #expect(FilterPresetStore(defaults: defaults).saved.isEmpty)

        #expect(!FilterPreset(
            searchQuery: "",
            methodFilters: [],
            domainFilters: ["api.example.com"],
            statusGroup: nil,
            sortField: .time,
            sortAscending: false,
            groupBy: .none
        ).isEmpty)

        let legacy = ["v1", "url:api", "GET", "2xx", "Time", "true", "Host"].joined(separator: "\u{001F}")
        let decodedLegacy = FilterPreset.deserialised(legacy)
        #expect(decodedLegacy?.domainFilters.isEmpty == true)
        #expect(decodedLegacy?.statusGroup == "2xx")
        #expect(decodedLegacy?.sortField == .time)
        #expect(decodedLegacy?.sortAscending == true)
        #expect(decodedLegacy?.groupBy == .host)
    }
}
#endif
