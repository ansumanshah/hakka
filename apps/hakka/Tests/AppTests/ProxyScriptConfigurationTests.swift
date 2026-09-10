import Foundation
import Testing
@testable import HakkaApp

@Suite("Proxy script configuration")
struct ProxyScriptConfigurationTests {
    @Test("loads, edits, saves, and consumes one launch authorization")
    func launchAuthorization() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("proxy.js")
        try "function onRequest(request) { request.method = 'PUT'; }".write(to: file, atomically: true, encoding: .utf8)

        var configuration = ProxyScriptConfiguration()
        try configuration.load(from: file)
        #expect(configuration.fileName == "proxy.js")
        #expect(configuration.isEnabledForNextLaunch == false)
        configuration.source = "function onResponse(response) { response.status = 201; }"
        configuration.isEnabledForNextLaunch = true

        #expect(try configuration.prepareForLaunch() == file.path)
        #expect(configuration.isEnabledForNextLaunch == false)
        #expect(try String(contentsOf: file, encoding: .utf8) == configuration.source)
        #expect(try configuration.prepareForLaunch() == nil)
    }

    @Test("rejects invalid source and clears authorization when launch validation fails")
    func validation() throws {
        #expect(throws: ProxyScriptConfigurationError.emptySource) { try ProxyScriptConfiguration.validate("  \n") }
        #expect(throws: ProxyScriptConfigurationError.missingHook) { try ProxyScriptConfiguration.validate("const value = 1") }
        #expect(throws: ProxyScriptConfigurationError.sourceTooLarge) {
            try ProxyScriptConfiguration.validate("// onRequest\n" + String(repeating: "x", count: 256 * 1024))
        }

        var configuration = ProxyScriptConfiguration(fileURL: nil, source: "function onRequest() {}", isEnabledForNextLaunch: true)
        #expect(throws: ProxyScriptConfigurationError.noFile) { try configuration.prepareForLaunch() }
        #expect(configuration.isEnabledForNextLaunch == false)
    }

    @Test("rejects directories and oversized files")
    func fileValidation() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var configuration = ProxyScriptConfiguration()
        #expect(throws: ProxyScriptConfigurationError.notAFile) { try configuration.load(from: directory) }

        let file = directory.appendingPathComponent("large.js")
        try Data(repeating: 0x78, count: 256 * 1024 + 1).write(to: file)
        #expect(throws: ProxyScriptConfigurationError.sourceTooLarge) { try configuration.load(from: file) }
    }
}
