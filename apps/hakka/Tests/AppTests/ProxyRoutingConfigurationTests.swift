import Foundation
@testable import HakkaApp
import Testing

@Suite("Proxy routing configuration")
struct ProxyRoutingConfigurationTests {
    private func defaults() throws -> UserDefaults {
        try #require(UserDefaults(suiteName: "hakka.tests.routing.\(UUID().uuidString)"))
    }

    @Test @MainActor func encodesEndpointScopedAuthenticationWithoutPersistingSecrets() throws {
        let store = try defaults()
        let routing = ProxyRoutingConfiguration(defaults: store)
        routing.mode = .upstream
        routing.proxyURL = "https://proxy.example:8443/"
        routing.username = "worker"
        routing.password = "secret"
        let data = try routing.configurationData().get()
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let upstream = try #require(json["upstream"] as? [String: Any])
        let authentication = try #require(upstream["authentication"] as? [String: String])
        #expect(upstream["url"] as? String == "https://proxy.example:8443")
        #expect(authentication == ["username": "worker", "password": "secret"])
        routing.persistNonSensitiveSettings()
        #expect(store.dictionaryRepresentation().values.contains { ($0 as? String) == "secret" } == false)
    }

    @Test @MainActor func scopesPACAuthenticationToItsExactProxyURL() throws {
        let routing = try ProxyRoutingConfiguration(defaults: defaults())
        routing.mode = .pac
        routing.pacSource = .url
        routing.pacValue = "https://config.example/proxy.pac"
        routing.proxyURL = "http://127.0.0.1:3128"
        routing.username = "pac-user"
        routing.password = "pac-secret"
        let data = try routing.configurationData().get()
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let entries = try #require(json["authentication"] as? [[String: Any]])
        #expect(entries.count == 1)
        #expect(entries[0]["url"] as? String == "http://127.0.0.1:3128")
        #expect((json["pac"] as? [String: String])?["url"] == "https://config.example/proxy.pac")
    }

    @Test @MainActor func writesPrivateConfigurationFile() throws {
        let routing = try ProxyRoutingConfiguration(defaults: defaults())
        routing.mode = .direct
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hakka-routing-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("routing.json")
        try routing.writeConfiguration(to: url)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    }

    @Test @MainActor func rejectsCredentialsInURLIncompleteAuthenticationAndMissingPAC() throws {
        let routing = try ProxyRoutingConfiguration(defaults: defaults())
        routing.mode = .upstream
        routing.proxyURL = "http://user:password@proxy.example:8080"
        #expect(routing.configurationData() == .failure(.proxyCredentialsInURL))
        routing.proxyURL = "http://proxy.example:8080"
        routing.username = "user"
        routing.password = ""
        #expect(routing.configurationData() == .failure(.incompleteAuthentication))
        routing.clearCredentials()
        routing.mode = .pac
        routing.pacValue = ""
        #expect(routing.configurationData() == .failure(.missingPACSource))
    }
}
