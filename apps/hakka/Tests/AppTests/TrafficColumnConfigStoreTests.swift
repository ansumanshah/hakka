import Foundation
import Testing
@testable import HakkaApp

/// Each test gets its own `UserDefaults` suite so persistence checks never
/// collide across parallel runs or leak into `.standard`.
@MainActor
@Suite("TrafficColumnConfigStore")
struct TrafficColumnConfigStoreTests {
    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "hakka.tests.trafficColumns.\(UUID().uuidString)")!
    }

    @Test func defaultColumnSetIsEveryColumnVisibleInDeclaredOrder() {
        let store = TrafficColumnConfigStore(defaults: freshDefaults())
        #expect(store.columns.map(\.column) == TrafficColumnConfigStore.defaultOrder)
        #expect(store.columns.allSatisfy { $0.isVisible })
        #expect(store.visibleColumnsInOrder == TrafficColumnConfigStore.defaultOrder)
    }

    @Test func reorderSurvivesSaveAndLoad() {
        let defaults = freshDefaults()
        let store = TrafficColumnConfigStore(defaults: defaults)
        store.move(.device, before: .method)

        let reloaded = TrafficColumnConfigStore(defaults: defaults)
        #expect(reloaded.columns.first?.column == .device)
        #expect(reloaded.visibleColumnsInOrder.first == .device)
    }

    @Test func hidingEveryColumnIsRefused() {
        let store = TrafficColumnConfigStore(defaults: freshDefaults())
        for column in TrafficColumn.allCases where column != .method {
            store.setVisible(false, for: column)
        }
        #expect(store.visibleColumnsInOrder == [.method])

        // The last visible column refuses to hide.
        store.setVisible(false, for: .method)
        #expect(store.visibleColumnsInOrder == [.method])
    }

    @Test func hiddenColumnCanBeShownAgain() {
        let store = TrafficColumnConfigStore(defaults: freshDefaults())
        store.setVisible(false, for: .device)
        #expect(!store.isVisible(.device))
        store.setVisible(true, for: .device)
        #expect(store.isVisible(.device))
    }

    /// A future app version might persist a column this build has never
    /// heard of. Decoding must drop it, not crash — and must not lose the
    /// columns it *does* recognize.
    @Test func unknownPersistedColumnIsIgnoredNotCrashing() throws {
        let defaults = freshDefaults()
        let key = "hakka.traffic.tableColumns"
        let json = """
        [
            {"column": "method", "isVisible": true},
            {"column": "graphqlOperation", "isVisible": true},
            {"column": "status", "isVisible": false}
        ]
        """
        defaults.set(Data(json.utf8), forKey: key)

        let store = TrafficColumnConfigStore(defaults: defaults)
        #expect(store.columns.map(\.column).contains(.method))
        #expect(store.columns.map(\.column).contains(.status))
        #expect(!store.isVisible(.status))
        // Every known column is still represented (missing ones from the
        // persisted set are appended), and no crash occurred getting here.
        #expect(Set(store.columns.map(\.column)) == Set(TrafficColumn.allCases))
    }

    @Test func resetToDefaultRestoresOrderAndVisibility() {
        let store = TrafficColumnConfigStore(defaults: freshDefaults())
        store.move(.device, before: .method)
        store.setVisible(false, for: .size)

        store.resetToDefault()
        #expect(store.columns.map(\.column) == TrafficColumnConfigStore.defaultOrder)
        #expect(store.columns.allSatisfy { $0.isVisible })
    }
}
