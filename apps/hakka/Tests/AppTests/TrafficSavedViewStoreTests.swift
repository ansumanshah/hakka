import Foundation
@testable import HakkaApp
import Testing

@MainActor
@Suite("TrafficSavedViewStore")
struct TrafficSavedViewStoreTests {
    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "hakka.tests.savedTrafficViews.\(UUID().uuidString)")!
    }

    @Test func savedViewPersistsOnlyItsInvestigationMetadata() {
        let defaults = freshDefaults()
        let store = TrafficSavedViewStore(defaults: defaults)
        let saved = store.add(name: "Failed payments", query: "host:payments.example 5xx", selectedRequestID: "request-42")

        #expect(saved?.name == "Failed payments")
        let reloaded = TrafficSavedViewStore(defaults: defaults)
        #expect(reloaded.activeView?.id == saved?.id)
        #expect(reloaded.activeView?.query == "host:payments.example 5xx")
        #expect(reloaded.activeView?.selectedRequestID == "request-42")
    }

    @Test func switchingViewsSavesOutgoingQueryAndSelectionBeforeRestoringTarget() throws {
        let store = TrafficSavedViewStore(defaults: freshDefaults())
        let first = try #require(store.add(name: "Errors", query: "5xx", selectedRequestID: "error-1"))
        let second = try #require(store.add(name: "Checkout", query: "host:checkout.example", selectedRequestID: "checkout-1"))

        let restored = store.activate(first, currentQuery: "host:checkout.example method:POST", currentSelection: "checkout-2")
        #expect(restored.query == "5xx")
        #expect(restored.selectedRequestID == "error-1")
        #expect(store.views.first(where: { $0.id == second.id })?.query == "host:checkout.example method:POST")
        #expect(store.views.first(where: { $0.id == second.id })?.selectedRequestID == "checkout-2")
    }

    @Test func showingAllTrafficKeepsSavedViewForLaterAndClearsActiveMetadata() throws {
        let defaults = freshDefaults()
        let store = TrafficSavedViewStore(defaults: defaults)
        let saved = try #require(store.add(name: "API", query: "host:api.example", selectedRequestID: "api-1"))

        store.showAllTraffic(currentQuery: "host:api.example method:GET", currentSelection: "api-2")

        #expect(store.activeView == nil)
        #expect(store.views.first?.query == "host:api.example method:GET")
        #expect(TrafficSavedViewStore(defaults: defaults).activeView == nil)
        #expect(TrafficSavedViewStore(defaults: defaults).views.first?.id == saved.id)
    }

    @Test func renamingAndClosingActiveViewArePersisted() throws {
        let defaults = freshDefaults()
        let store = TrafficSavedViewStore(defaults: defaults)
        let saved = try #require(store.add(name: "Original", query: "status:404", selectedRequestID: nil))

        #expect(store.rename(saved, to: "Missing routes"))
        #expect(store.close(saved, currentQuery: "status:404", currentSelection: "missing-1"))

        let reloaded = TrafficSavedViewStore(defaults: defaults)
        #expect(reloaded.views.isEmpty)
        #expect(reloaded.activeView == nil)
    }
}
