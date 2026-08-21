import Foundation
import Testing
@testable import HakkaApp

/// Each test gets its own `UserDefaults` suite so persistence checks never
/// collide across parallel runs or leak into `.standard`.
@MainActor
@Suite("NoiseScopeStore")
struct NoiseScopeStoreTests {
    private func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "hakka.tests.noiseScope.\(UUID().uuidString)")!
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
}
