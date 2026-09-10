@testable import HakkaApp
import Testing

@Suite("Proxy connection diagnostics")
struct ProxyConnectionProbeTests {
    @Test func ignoresUserCurlConfigurationAndProxyBypass() {
        let probe = ProxyConnectionProbe(port: 8081, certificatePath: "/tmp/public ca.pem")
        #expect(probe.arguments.first == "--disable")
        #expect(probe.arguments.contains("http://127.0.0.1:8081"))
        #expect(probe.arguments.contains("/tmp/public ca.pem"))
        #expect(probe.arguments.last == "https://example.com")
        #expect(!probe.arguments.contains("--insecure"))
    }

    @Test func rejectsInvalidPortWithoutLaunching() async {
        let result = await ProxyConnectionProbe(port: -1, certificatePath: nil).run()
        #expect(!result.succeeded)
    }

    @Test func separatesTrustFailureFromHttpFailure() {
        let trust = ProxyConnectionProbe.result(exitCode: 60)
        let http = ProxyConnectionProbe.result(exitCode: 22)
        #expect(!trust.succeeded)
        #expect(!http.succeeded)
        #expect(trust.message.contains("certificate"))
        #expect(http.message.contains("HTTP error"))
        #expect(ProxyConnectionProbe.result(exitCode: 0).succeeded)
    }
}
