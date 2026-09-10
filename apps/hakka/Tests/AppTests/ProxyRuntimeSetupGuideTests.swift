import Foundation
@testable import HakkaApp
import Testing

@Suite("Developer proxy runtime setup")
struct ProxyRuntimeSetupGuideTests {
    @Test func rejectsMissingCertificateOrInvalidPort() {
        #expect(ProxyRuntimeSetupGuide(port: 0, certificatePath: "/tmp/ca.pem") == nil)
        #expect(ProxyRuntimeSetupGuide(port: 8080, certificatePath: nil) == nil)
    }

    @Test func quotesCertificatePathsAndUsesScopedTrust() throws {
        let guide = try #require(ProxyRuntimeSetupGuide(port: 8081, certificatePath: "/tmp/Hakka's CA.pem"))
        let command = guide.command(for: .pythonRequests)
        #expect(command.contains("REQUESTS_CA_BUNDLE='/tmp/Hakka'\"'\"'s CA.pem'"))
        #expect(command.contains("HTTPS_PROXY='http://127.0.0.1:8081'"))
        #expect(command.contains("https_proxy='http://127.0.0.1:8081'"))
        #expect(command.contains("ALL_PROXY='' all_proxy='' NO_PROXY='' no_proxy=''"))
        #expect(!command.contains("NODE_TLS_REJECT_UNAUTHORIZED"))
    }

    @Test func quotesAValueAsOneShellArgument() throws {
        let value = "/tmp/Hakka's $CA; test.pem"
        let process = Process()
        let output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "printf '%s' \(ProxyRuntimeSetupGuide.shellQuote(value))"]
        process.standardOutput = output
        try process.run()
        process.waitUntilExit()
        #expect(process.terminationStatus == 0)
        #expect(String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self) == value)
    }

    @Test func forcesProxyRoutingAndUsesEachRuntimeTrustMechanism() throws {
        let guide = try #require(ProxyRuntimeSetupGuide(port: 8080, certificatePath: "/tmp/ca.pem"))
        let node = guide.command(for: .nodeUndici)
        #expect(node.contains("NODE_EXTRA_CA_CERTS='/tmp/ca.pem'"))
        #expect(node.contains("ProxyAgent"))
        #expect(node.contains("AbortSignal.timeout(15000)"))
        #expect(node.contains("Promise.race([dispatcher.close()"))
        #expect(!node.contains("NODE_TLS_REJECT_UNAUTHORIZED"))

        let curl = guide.command(for: .curl)
        #expect(curl.hasPrefix("curl --disable --noproxy ''"))
        #expect(curl.contains("--cacert '/tmp/ca.pem'"))
        #expect(curl.contains("--connect-timeout 5 --max-time 15"))
        #expect(!curl.contains("--insecure"))
    }
}
