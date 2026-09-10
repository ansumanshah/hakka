import Foundation
@testable import HakkaApp
import Testing

@Suite("Proxy rule file")
struct ProxyRuleFileTests {
    @Test func preservesLegacyMappingFiles() throws {
        let data = Data(#"{"mapLocal":[],"mapRemote":[{"match":"/api","replace":"https://staging.test"}]}"#.utf8)
        let rules = try JSONDecoder().decode(ProxyMappingFile.self, from: data)
        #expect(rules.mapRemote.first?.replace == "https://staging.test")
        #expect(rules.headerRules.isEmpty)
        #expect(rules.blockRules.isEmpty)
        #expect(rules.delayRules.isEmpty)
    }

    @Test func writesPortablePhaseSpecificRules() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let output = directory.appendingPathComponent("rules.json")
        let rules = ProxyMappingFile(
            headerRules: [ProxyHeaderRule(match: "^https://api\\.test", phase: .response, operation: .set, name: "X-Proxy", value: "enabled")],
            blockRules: [ProxyBlockRule(match: "/analytics$", status: 451, body: "Disabled")],
            delayRules: [ProxyDelayRule(match: "/slow$", phase: .request, delayMs: 100)]
        )
        try rules.write(to: output)
        let saved = try JSONDecoder().decode(ProxyMappingFile.self, from: Data(contentsOf: output))
        #expect(saved.headerRules.first?.phase == .response)
        #expect(saved.blockRules.first?.status == 451)
        #expect(saved.delayRules.first?.delayMs == 100)
    }

    @Test func rejectsInvalidRuleValuesWithoutOverwritingTheSavedFile() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let output = directory.appendingPathComponent("rules.json")
        var rules = ProxyMappingFile(blockRules: [ProxyBlockRule(match: ".", status: 403)])
        try rules.write(to: output)
        rules.headerRules = [ProxyHeaderRule(match: ".", name: " X-Test ")]
        #expect(throws: (any Error).self) { try rules.write(to: output) }
        let saved = try JSONDecoder().decode(ProxyMappingFile.self, from: Data(contentsOf: output))
        #expect(saved.blockRules.first?.status == 403)
        #expect(saved.headerRules.isEmpty)
    }

    @Test func rejectsHeaderControlCharacters() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let output = directory.appendingPathComponent("rules.json")
        let rules = ProxyMappingFile(headerRules: [ProxyHeaderRule(match: ".", name: "X-Test", value: "ok\u{0000}bad")])
        #expect(throws: (any Error).self) { try rules.write(to: output) }
    }

    @Test func rejectsRegexSyntaxThePythonSidecarCannotRun() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let output = directory.appendingPathComponent("rules.json")
        for expression in ["(?<segment>api)", #"\q"#, #"\cA"#, "[]", "[^]", #"[\B]"#] {
            let rules = ProxyMappingFile(blockRules: [ProxyBlockRule(match: expression)])
            #expect(throws: (any Error).self) { try rules.write(to: output) }
        }
    }
}
