import Foundation
@testable import HakkaApp
import HakkaCommon
import Testing

/// Each test gets its own `UserDefaults` suite so persistence checks never
/// collide across parallel runs or leak into `.standard`.
@MainActor
@Suite("TrafficColumnConfigStore")
struct TrafficColumnConfigStoreTests {
    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "hakka.tests.trafficColumns.\(UUID().uuidString)")!
    }

    @Test func defaultColumnsPrioritizeRequestOutcomeAtCompactWidths() {
        let store = TrafficColumnConfigStore(defaults: freshDefaults())
        #expect(store.columns.map(\.column) == TrafficColumnConfigStore.defaultOrder)
        #expect(store.visibleColumnsInOrder == [.method, .path, .status, .duration])
    }

    @Test func reorderSurvivesSaveAndLoad() {
        let defaults = freshDefaults()
        let store = TrafficColumnConfigStore(defaults: defaults)
        store.setVisible(true, for: .device)
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
    @Test func unknownPersistedColumnIsIgnoredNotCrashing() {
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
        _ = store.addHeaderColumn(named: "X-Trace-ID", source: .request)

        store.resetToDefault()
        #expect(store.columns.map(\.column) == TrafficColumnConfigStore.defaultOrder)
        #expect(store.visibleColumnsInOrder == [.method, .path, .status, .duration])
        #expect(store.headerColumns.isEmpty)
    }

    @Test func persistedColumnChoicesAreNotReplacedByNewDefaults() {
        let defaults = freshDefaults()
        let store = TrafficColumnConfigStore(defaults: defaults)
        store.setVisible(false, for: .status)
        store.setVisible(true, for: .host)
        store.move(.host, before: .path)
        _ = store.addHeaderColumn(named: "X-Trace-ID", source: .response)

        let reloaded = TrafficColumnConfigStore(defaults: defaults)
        #expect(reloaded.visibleColumnsInOrder == [.method, .host, .path, .duration])
        #expect(reloaded.headerColumns.map(\.title) == ["Response: X-Trace-ID"])
        #expect(reloaded.visibleTableColumnsInOrder.last?.title == "Response: X-Trace-ID")
    }

    @Test func customHeaderColumnPersistsAndKeepsRequestAndResponseDistinct() {
        let defaults = freshDefaults()
        let store = TrafficColumnConfigStore(defaults: defaults)
        let request = store.addHeaderColumn(named: "X-Trace-ID", source: .request)
        let response = store.addHeaderColumn(named: "X-Trace-ID", source: .response)

        #expect(request != nil)
        #expect(response != nil)
        #expect(store.headerColumns.count == 2)

        let reloaded = TrafficColumnConfigStore(defaults: defaults)
        #expect(reloaded.headerColumns.map(\.title) == ["Request: X-Trace-ID", "Response: X-Trace-ID"])
        #expect(reloaded.visibleTableColumnsInOrder.suffix(2).map(\.title) == ["Request: X-Trace-ID", "Response: X-Trace-ID"])
    }

    @Test func customHeaderColumnsDeduplicateCaseInsensitivelyAndCanBeRemoved() {
        let store = TrafficColumnConfigStore(defaults: freshDefaults())
        let first = store.addHeaderColumn(named: "X-Request-ID", source: .response)
        let duplicate = store.addHeaderColumn(named: "x-request-id", source: .response)

        #expect(first == duplicate)
        #expect(store.headerColumns.count == 1)
        if let first {
            store.removeHeaderColumn(first)
        }
        #expect(store.headerColumns.isEmpty)
    }

    @Test func customHeaderColumnRejectsInvalidHTTPFieldName() {
        let store = TrafficColumnConfigStore(defaults: freshDefaults())
        #expect(store.addHeaderColumn(named: "X Invalid", source: .request) == nil)
        #expect(store.addHeaderColumn(named: "X:Invalid", source: .request) == nil)
        #expect(store.headerColumns.isEmpty)
    }

    @Test func headerValueLookupIsCaseInsensitiveAndRetainsAllValues() {
        let column = TrafficHeaderColumn(headerName: "x-request-id", source: .response)
        let request = NetworkRequest(
            url: "https://api.example.com/items",
            method: .get,
            startTime: 0,
            responseHeaders: ["X-Request-ID": ["first", "second"]]
        )

        #expect(column.value(in: request) == "first, second")
    }
}
