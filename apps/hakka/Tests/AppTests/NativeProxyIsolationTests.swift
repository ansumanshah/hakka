import Foundation
@testable import HakkaApp
import HakkaServer
import Testing

@MainActor
@Suite("Native proxy agent routing isolation")
struct NativeProxyIsolationTests {
    @Test func invalidArgumentsNeverDispatchStartStopOrStatus() async {
        let invalidArguments: [MCPValue] = [
            .null, .array([]), .string("start"), .number(1), .bool(true),
            .object(["allowMacRouting": .bool(true)]), .object(["command": .string("stop")]),
        ]
        for name in ["proxy_start", "proxy_stop", "proxy_status"] {
            let counter = ActionCounter()
            let tool = NativeProxyTool(name: name, description: "Injected action") {
                counter.actions += 1
                return .json(.object([:]))
            }
            for arguments in invalidArguments {
                #expect((await tool.call(arguments)).isError)
                #expect(counter.actions == 0)
            }
            #expect(!(await tool.call(.object([:]))).isError)
            #expect(counter.actions == 1)
        }
    }

    @Test func configuredMacRoutingIsUnavailableBeforeAnyCaptureMutation() async throws {
        let fixture = Fixture()
        fixture.proxy.allowAgentControl = true
        fixture.proxy.routeThisMac = true
        let initialMessage = fixture.proxy.message
        let initialIdentity = fixture.proxy.deviceSetupCaptureIdentity
        let result = await fixture.tool("proxy_start").call(.object([:]))
        let status = try payload(result)
        #expect(result.isError && status["state"] == .string("unavailable"))
        #expect(status["agentStartBlockedReason"] == .string("mac_system_proxy_routing_disallowed"))
        #expect(status["routingScope"] == .string("mac_system_proxy"))
        #expect(fixture.proxy.state == .stopped && fixture.proxy.routeThisMac)
        #expect(fixture.proxy.deviceSetupCaptureIdentity == initialIdentity && fixture.proxy.message == initialMessage)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        #expect(await fixture.transport.calls == 0)
        let readOnlyStatus = try payload(await fixture.tool("proxy_status").call(.object([:])))
        #expect(readOnlyStatus["isolatedRoutingAvailable"] == .bool(false))
        #expect(readOnlyStatus["agentStartBlockedReason"] == status["agentStartBlockedReason"])
    }

    @Test func uncheckedRecoveryBlocksStartWithoutTriggeringRecovery() async throws {
        let fixture = Fixture()
        fixture.proxy.allowAgentControl = true
        let identity = fixture.proxy.deviceSetupCaptureIdentity
        #expect(!fixture.proxy.isSystemProxyRoutingRecoveryChecked)
        let result = await fixture.tool("proxy_start").call(.object([:]))
        #expect(try payload(result)["agentStartBlockedReason"] == .string("mac_system_proxy_restoration_unconfirmed"))
        #expect(fixture.proxy.deviceSetupCaptureIdentity == identity && fixture.proxy.state == .stopped)
        #expect(!fixture.proxy.isSystemProxyRoutingRecoveryChecked)
        #expect(!FileManager.default.fileExists(atPath: fixture.directory.path))
        #expect(await fixture.transport.calls == 0)
    }

    @Test func pendingRecoveryBlocksStartAndRemainsIntact() async throws {
        let fixture = Fixture()
        try FileManager.default.createDirectory(at: fixture.directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: fixture.directory) }
        let journal = fixture.directory.appendingPathComponent("system-proxy-routing.json")
        let invalidJournal = Data("unreadable prior routing journal".utf8)
        try invalidJournal.write(to: journal)
        // Only an injected transport can be consulted; no Mac settings are used in this test.
        await fixture.proxy.recoverSystemProxyRouting()
        #expect(fixture.proxy.isSystemProxyRoutingRecoveryChecked && fixture.proxy.isSystemProxyRoutingRecoveryPending)
        fixture.proxy.allowAgentControl = true
        let identity = fixture.proxy.deviceSetupCaptureIdentity
        let result = await fixture.tool("proxy_start").call(.object([:]))
        #expect(try payload(result)["agentStartBlockedReason"] == .string("mac_system_proxy_restoration_unconfirmed"))
        #expect(fixture.proxy.state == .stopped && fixture.proxy.deviceSetupCaptureIdentity == identity)
        #expect(try Data(contentsOf: journal) == invalidJournal)
        #expect(await fixture.transport.calls == 0)
    }

    @Test func checkedClientOnlyRoutingReachesBridgeGateAndCleanupRemainsAvailable() async throws {
        let fixture = Fixture()
        await fixture.proxy.recoverSystemProxyRouting()
        fixture.proxy.allowAgentControl = true
        #expect(fixture.proxy.isSystemProxyRoutingRecoveryChecked)
        let status = try payload(await fixture.tool("proxy_status").call(.object([:])))
        #expect(status["routingScope"] == .string("configured_clients_only"))
        #expect(status["routingRecoveryChecked"] == .bool(true))
        #expect(status["isolatedRoutingAvailable"] == .bool(true) && status["agentStartBlockedReason"] == .null)
        let start = await fixture.tool("proxy_start").call(.object([:]))
        #expect(try payload(start)["error"] == .string("The desktop traffic bridge is not running."))
        fixture.proxy.routeThisMac = true
        #expect(!(await fixture.tool("proxy_stop").call(.object([:]))).isError)
        #expect(fixture.proxy.state == .stopped && !fixture.proxy.isSystemProxyRoutingRecoveryPending)
        #expect(await fixture.transport.calls == 0)
    }

    private func payload(_ result: MCPToolResult) throws -> MCPValue {
        let text = try #require(result.content.first?["text"]?.stringValue)
        return try JSONDecoder().decode(MCPValue.self, from: Data(text.utf8))
    }

    @MainActor private final class ActionCounter {
        var actions = 0
    }

    @MainActor private final class Fixture {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let transport = RefusingRoutingTransport()
        let proxy: ProxyCaptureModel
        let traffic = TrafficModel()
        init() {
            proxy = ProxyCaptureModel(defaults: UserDefaults(suiteName: UUID().uuidString)!, directory: directory,
                systemProxyRouter: SystemProxyRouter(transport: transport, journalURL: directory.appendingPathComponent("system-proxy-routing.json")))
        }
        func tool(_ name: String) -> any MCPTool {
            NativeProxyTool.tools(proxy: proxy, traffic: traffic).first { $0.name == name }!
        }
    }
}

private actor RefusingRoutingTransport: SystemProxyCommandTransport {
    private(set) var calls = 0
    func run(arguments: [String]) async throws -> SystemProxyCommandResult {
        calls += 1
        throw SystemProxyCommandError.failed(1, "Unexpected routing command in isolation test")
    }
}
