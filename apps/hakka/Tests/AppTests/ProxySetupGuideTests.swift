import Foundation
@testable import HakkaApp
import Testing

@Suite("Proxy setup commands")
struct ProxySetupGuideTests {
    @Test func rejectsInvalidPorts() {
        #expect(ProxySetupGuide.testCommand(port: 0, certificatePath: nil) == nil)
        #expect(ProxySetupGuide.testCommand(port: 65536, certificatePath: nil) == nil)
    }

    @Test func forcesProxyDespiteNoProxyEnvironment() throws {
        let command = try #require(ProxySetupGuide.testCommand(port: 8081, certificatePath: nil))
        #expect(command.contains("--noproxy '' --proxy http://127.0.0.1:8081"))
        #expect(command.hasSuffix(" http://example.com"))
        #expect(!command.contains("--insecure"))
    }

    @Test func certificatePathSurvivesShellParsing() throws {
        let path = "/tmp/Hakka's certificate $(echo unsafe).pem"
        let command = try #require(ProxySetupGuide.testCommand(port: 8080, certificatePath: path))
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", "curl() { printf '%s\\n' \"$@\"; }; " + command]
        let output = Pipe()
        process.standardOutput = output
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let arguments = String(decoding: data, as: UTF8.self).components(separatedBy: "\n")
        #expect(process.terminationStatus == 0)
        #expect(arguments.contains(path))
        #expect(arguments.contains("https://example.com"))
        #expect(arguments.contains("--cacert"))
    }
}
