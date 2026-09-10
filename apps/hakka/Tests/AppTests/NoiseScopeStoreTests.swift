import Foundation
@testable import HakkaApp
import HakkaCommon
import Testing

/// Each test gets its own `UserDefaults` suite so persistence checks never
/// collide across parallel runs or leak into `.standard`.
@MainActor
@Suite("NoiseScopeStore")
struct NoiseScopeStoreTests {
    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "hakka.tests.noiseScope.\(UUID().uuidString)")!
    }

    @Test func manualMuteNormalizesWhitespaceAndIgnoresBlankInput() {
        let store = NoiseScopeStore(defaults: freshDefaults())
        store.mute(host: " API.example.com ")
        store.mute(host: "  ")
        #expect(store.excludeRules.map(\.host) == ["api.example.com"])
        #expect(store.hides(host: "api.example.com"))
    }

    @Test func excludeBeatsIncludeForTheSameHost() {
        let store = NoiseScopeStore(defaults: freshDefaults())
        store.focus(host: "api.example.com")
        store.mute(host: "api.example.com")
        #expect(store.hides(host: "api.example.com"))
    }

    @Test func includeRuleHidesEverythingElse() {
        let store = NoiseScopeStore(defaults: freshDefaults())
        store.focus(host: "api.example.com")
        #expect(!store.hides(host: "api.example.com"))
        #expect(store.hides(host: "other.example.com"))
    }

    @Test func scopeSurvivesSaveAndLoad() {
        let defaults = freshDefaults()
        let store = NoiseScopeStore(defaults: defaults)
        store.mute(host: "chatty.example.com")
        store.focus(host: "api.example.com")

        let reloaded = NoiseScopeStore(defaults: defaults)
        #expect(reloaded.excludeRules.map(\.host) == ["chatty.example.com"])
        #expect(reloaded.includeRules.map(\.host) == ["api.example.com"])
    }

    @Test func clearRestoresEveryHost() {
        let store = NoiseScopeStore(defaults: freshDefaults())
        store.mute(host: "chatty.example.com")
        store.focus(host: "api.example.com")
        #expect(store.isActive)

        store.clear()
        #expect(!store.isActive)
        #expect(!store.hides(host: "chatty.example.com"))
        #expect(!store.hides(host: "anything-else.example.com"))
    }

    @Test func focusSetNarrowsByDomainPathAndMethod() throws {
        let store = NoiseScopeStore(defaults: freshDefaults())
        let focus = try #require(store.saveFocusSet(
            name: "Orders writes",
            domains: ["api.example.com"],
            pathPrefix: "/v1/orders",
            methods: ["post"]
        ))
        store.apply(focus)

        #expect(!store.hides(request(url: "https://api.example.com/v1/orders/42", method: .post)))
        #expect(store.hides(request(url: "https://api.example.com/v1/orders/42", method: .get)))
        #expect(store.hides(request(url: "https://api.example.com/v1/users", method: .post)))
        #expect(store.hides(request(url: "https://cdn.example.com/v1/orders/42", method: .post)))
    }

    @Test func focusSetDomainIncludesSubdomainsButNotSubstringLookalikes() throws {
        let store = NoiseScopeStore(defaults: freshDefaults())
        let focus = try #require(store.saveFocusSet(name: "Example", domains: ["example.com"]))
        store.apply(focus)

        #expect(!store.hides(request(url: "https://example.com/v1", method: .get)))
        #expect(!store.hides(request(url: "https://api.example.com/v1", method: .get)))
        #expect(store.hides(request(url: "https://evilapi.example.com.attacker.test/v1", method: .get)))
    }

    @Test func mutedDomainWinsOverAnActiveFocusSet() throws {
        let store = NoiseScopeStore(defaults: freshDefaults())
        let focus = try #require(store.saveFocusSet(name: "API", domains: ["api.example.com"]))
        store.mute(host: "api.example.com")
        store.apply(focus)

        #expect(store.hides(request(url: "https://api.example.com/v1/orders", method: .get)))
    }

    @Test func focusSetsAndActiveSelectionSurviveSaveAndLoad() throws {
        let defaults = freshDefaults()
        let store = NoiseScopeStore(defaults: defaults)
        let focus = try #require(store.saveFocusSet(name: "Mutations", domains: ["api.example.com"], methods: ["POST", "PATCH"]))
        store.apply(focus)

        let reloaded = NoiseScopeStore(defaults: defaults)
        #expect(reloaded.focusSets.map(\.name) == ["Mutations"])
        #expect(reloaded.activeFocusSet?.id == focus.id)
        #expect(!reloaded.hides(request(url: "https://api.example.com/v1/orders", method: .patch)))
    }

    @Test func clearingFocusLeavesSavedSetsAndNoiseControlsAvailable() throws {
        let store = NoiseScopeStore(defaults: freshDefaults())
        let focus = try #require(store.saveFocusSet(name: "API", domains: ["api.example.com"]))
        store.mute(host: "telemetry.example.com")
        store.apply(focus)

        store.apply(nil)
        #expect(store.activeFocusSet == nil)
        #expect(store.focusSets == [focus])
        #expect(store.hides(request(url: "https://telemetry.example.com/event", method: .post)))
        #expect(!store.hides(request(url: "https://cdn.example.com/image", method: .get)))
    }

    @Test func loadingThePriorHostOnlyPayloadKeepsExistingRules() throws {
        struct LegacyPayload: Codable {
            let include: [NoiseScopeStore.Rule]
            let exclude: [NoiseScopeStore.Rule]
        }

        let defaults = freshDefaults()
        let payload = LegacyPayload(include: [NoiseScopeStore.Rule(host: "api.example.com")], exclude: [])
        try defaults.set(JSONEncoder().encode(payload), forKey: "hakka.traffic.noiseScope")

        let reloaded = NoiseScopeStore(defaults: defaults)
        #expect(reloaded.includeRules.map(\.host) == ["api.example.com"])
        #expect(reloaded.focusSets.isEmpty)
        #expect(!reloaded.hides(request(url: "https://api.example.com/orders", method: .get)))
        #expect(reloaded.hides(request(url: "https://cdn.example.com/orders", method: .get)))
    }

    private func request(url: String, method: HttpMethod) -> NetworkRequest {
        NetworkRequest(id: UUID().uuidString, url: url, method: method, status: 200, startTime: 0)
    }
}
