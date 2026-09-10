import Foundation
import Testing
@testable import HakkaApp

@Suite("Proxy upstream")
struct ProxyUpstreamTests {
    private func defaults() throws -> UserDefaults {
        try #require(UserDefaults(suiteName: "hakka.tests.upstream.\(UUID().uuidString)"))
    }

    @Test @MainActor func emitsCLIArgumentsAndPersistsValidatedURL() throws {
        let store = try defaults()
        let upstream = ProxyUpstream(defaults: store)
        upstream.url = "https://[2001:db8::1]:8443"
        #expect(upstream.cliArguments() == .success(["--upstream-proxy", "https://[2001:db8::1]:8443"]))
        upstream.url = "http://proxy.example:8080/"
        #expect(upstream.cliArguments() == .success(["--upstream-proxy", "http://proxy.example:8080"]))
        upstream.url = "https://[2001:db8::1]:8443"
        upstream.persist()
        #expect(ProxyUpstream(defaults: store).url == "https://[2001:db8::1]:8443")
        upstream.reset()
        #expect(ProxyUpstream(defaults: store).url.isEmpty)
    }

    @Test @MainActor func rejectsCredentialsPACPathsAndUnboundedPorts() throws {
        let upstream = ProxyUpstream(defaults: try defaults())
        for value in ["http://proxy.example", "http://proxy.example:0", "http://user:pass@proxy.example:8080", "https://proxy.example:443/pac", "https://proxy.example:443/a/..", "https://proxy.example:443?pac=true", "https://proxy\t.example:443", "https://proxy.example:１２３", "socks5://proxy.example:1080"] {
            upstream.url = value
            if case .success = upstream.cliArguments() { Issue.record("Accepted invalid upstream URL: \(value)") }
        }
    }
}
