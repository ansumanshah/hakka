import Foundation
import HakkaServer
import Testing
@testable import HakkaApp

@Suite("Native proxy capture")
struct ProxyCaptureTests {
    @Test @MainActor func agentControlRequiresWindowOptIn() async throws {
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let proxy = ProxyCaptureModel(defaults: defaults)
        let tools = NativeProxyTool.tools(proxy: proxy, traffic: TrafficModel())
        let start = try #require(tools.first { $0.name == "proxy_start" })
        let denied = await start.call(.object([:]))
        #expect(denied.isError)
        #expect(proxy.state == .stopped)
        proxy.allowAgentControl = true
        let unavailableBridge = await start.call(.object([:]))
        #expect(unavailableBridge.isError)
        #expect(proxy.state == .stopped)
        let status = try #require(tools.first { $0.name == "proxy_status" })
        #expect(await status.call(.object([:])).isError == false)
    }

    @Test func processDrainsFinalStatusBeforeExit() async throws {
        let (_, events) = try ProxyProcessStream.launch(
            executable: URL(fileURLWithPath: "/usr/bin/printf"),
            arguments: ["%s\\n%s", #"{"status":"started","port":8080}"#, #"{"status":"stopped","records":3}"#],
        )
        var statuses: [String] = []
        var exit: Int32?
        for await event in events {
            switch event {
            case let .status(status): statuses.append(status.status)
            case let .exited(code): exit = code
            case let .failure(reason): Issue.record("\(reason)")
            }
        }
        #expect(statuses == ["started", "stopped"])
        #expect(exit == 0)
    }

    @Test func malformedStatusFailsWithoutClaimingCaptureStarted() async throws {
        let (_, events) = try ProxyProcessStream.launch(executable: URL(fileURLWithPath: "/usr/bin/printf"), arguments: ["not-json\\n"])
        var failures = 0
        for await event in events {
            if case .failure = event { failures += 1 }
            if case .status = event { Issue.record("Malformed output became a status") }
        }
        #expect(failures == 1)
    }

    @Test @MainActor func validationDoesNotLaunchAndRestartClearsCertificate() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let defaults = try #require(UserDefaults(suiteName: UUID().uuidString))
        let model = ProxyCaptureModel(defaults: defaults, directory: directory)
        model.port = 0
        model.start()
        #expect(model.state == .failed)
        #expect(model.lastError == "Choose a port between 1 and 65535.")
        #expect(!model.isActive)
        let status = try JSONDecoder().decode(ProxyStatusLine.self, from: Data(#"{"status":"started","certificates":{"configDir":"/tmp","publicCaPath":"/tmp/public.pem","publicCaExists":true}}"#.utf8))
        model.consume(.status(status))
        #expect(model.certificatePath == "/tmp/public.pem")
        model.consume(.exited(0))
        model.start()
        #expect(model.certificatePath == nil)
    }

    @Test func mappingsRoundTripAndRejectDirectories() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let response = directory.appendingPathComponent("response.json")
        try Data("{}".utf8).write(to: response)
        let output = directory.appendingPathComponent("mappings.json")
        var mappings = ProxyMappingFile(mapLocal: [ProxyLocalMapping(match: "/api", file: response.path)])
        try mappings.write(to: output)
        let saved = try JSONDecoder().decode(ProxyMappingFile.self, from: Data(contentsOf: output))
        #expect(saved.mapLocal.first?.file == response.path)
        mappings.mapLocal[0].file = directory.path
        #expect(throws: (any Error).self) { try mappings.write(to: output) }
        #expect(try JSONDecoder().decode(ProxyMappingFile.self, from: Data(contentsOf: output)).mapLocal.first?.file == response.path)
    }
}
