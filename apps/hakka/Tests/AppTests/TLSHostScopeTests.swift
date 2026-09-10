@testable import HakkaApp
import Testing

@Suite("TLS host scope")
struct TLSHostScopeTests {
    @Test func validatesLiteralDomainsAndPorts() {
        var scope = TLSHostScope(entries: [TLSHostScopeEntry(host: "*.api.example.com:00443")])
        #expect(scope.validationMessage == nil)
        #expect(scope.enabledHosts == ["*.api.example.com:443"])
        scope.entries[0].host = "api.example.com:+443"
        #expect(scope.validationMessage != nil)
        scope.entries[0].host = "example.com|other.test"
        #expect(scope.validationMessage != nil)
    }

    @Test func requiresAnEnabledHostForAllowOnlyScope() {
        var scope = TLSHostScope(mode: .allowOnly)
        #expect(scope.validationMessage != nil)
        scope.entries = [TLSHostScopeEntry(host: "api.example.com", isEnabled: false)]
        #expect(scope.validationMessage != nil)
    }

    @Test func boundsEnabledHostEntries() {
        let entries = (0 ... TLSHostScope.maximumHostCount).map { _ in TLSHostScopeEntry(host: "api.example.com") }
        let scope = TLSHostScope(entries: entries)
        #expect(scope.validationMessage == "Use at most \(TLSHostScope.maximumHostCount) TLS hosts.")
    }
}
