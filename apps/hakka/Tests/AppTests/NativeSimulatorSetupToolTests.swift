import Foundation
@testable import HakkaApp
import HakkaCommon
import HakkaServer
import Testing

@MainActor
@Suite("Native Simulator agent tools")
struct NativeSimulatorSetupToolTests {
    @Test func rejectsInvalidArgumentsBeforeAnyInventoryOrCaptureMutation() async {
        let fixture = Fixture()
        fixture.proxy.allowAgentControl = true
        let tool = fixture.tool("proxy_simulator_setup")
        let invalidArguments: [MCPValue] = [.null, .array([]), .object([:]), .object(["targetID": .number(1)]),
                                    .object(["targetID": .string("booted")]),
                                    .object(["targetID": .string(fixture.runtime.target.id), "path": .string("/tmp/ca")])]
        for arguments in invalidArguments {
            #expect(await tool.call(arguments).isError)
        }
        for name in ["proxy_simulator_targets", "proxy_simulator_status", "proxy_simulator_cancel", "proxy_simulator_stop"] {
            #expect(await fixture.tool(name).call(.object(["command": .string("anything")])).isError)
        }
        #expect(fixture.runtime.events.isEmpty)
        #expect(fixture.setup.selectedTargetID == nil)
        #expect(!fixture.proxy.isActive && !fixture.proxy.routeThisMac)
    }

    @Test func deniedActionsAndMissingBridgeDoNotMutate() async {
        let fixture = Fixture()
        #expect(await fixture.tool("proxy_simulator_setup").call(.object(["targetID": .string(fixture.runtime.target.id)])).isError)
        #expect(await fixture.tool("proxy_simulator_cancel").call(.object([:])).isError)
        #expect(await fixture.tool("proxy_simulator_stop").call(.object([:])).isError)
        fixture.proxy.allowAgentControl = true
        #expect(await fixture.tool("proxy_simulator_setup").call(.object(["targetID": .string(fixture.runtime.target.id)])).isError)
        #expect(fixture.runtime.events.isEmpty && fixture.setup.selectedTargetID == nil)
        #expect(!fixture.proxy.routeThisMac)
    }

    @Test func inventoriesExactIDsAndReportsDiscoveryFailure() async throws {
        let fixture = Fixture()
        let result = await fixture.tool("proxy_simulator_targets").call(.object([:]))
        #expect(!result.isError)
        #expect(try payload(result)["targets"] == .array([.object(["targetID": .string(fixture.runtime.target.id), "name": .string("Test iPhone"), "state": .string("Shutdown"), "isBooted": .bool(false)])]))
        fixture.runtime.discoveryError = SimulatorSetupFailure(message: "Unavailable Xcode")
        let failed = await fixture.tool("proxy_simulator_targets").call(.object([:]))
        #expect(failed.isError)
        #expect(try payload(failed)["targets"] == .array([]))
        #expect(!fixture.proxy.isActive)
    }

    @Test func agentSetupIsUnavailableBeforeAnyDiscoveryOrMutation() async throws {
        let fixture = Fixture()
        fixture.proxy.allowAgentControl = true
        let originalScope = fixture.proxy.tlsHostScope
        for routeThisMac in [false, true] {
            fixture.proxy.routeThisMac = routeThisMac
            let result = await fixture.tool("proxy_simulator_setup").call(.object([
                "targetID": .string(fixture.runtime.target.id), "hosts": .array([.string("api.example.org")]),
            ]))
            let status = try payload(result)
            #expect(result.isError && status["state"] == .string("unavailable"))
            #expect(status["agentStartBlockedReason"] == .string("simulator_isolated_routing_unavailable"))
            #expect(status["routingScope"] == .string("mac_system_proxy"))
            #expect(status["isolatedRoutingAvailable"] == .bool(false))
            #expect(fixture.runtime.events.isEmpty && fixture.setup.selectedTargetID == nil)
            #expect(!fixture.setup.hasReservation && !fixture.setup.isSettingUp)
            #expect(!fixture.proxy.isActive && fixture.proxy.routeThisMac == routeThisMac)
            #expect(fixture.proxy.tlsHostScope == originalScope)
            #expect(!FileManager.default.fileExists(atPath: fixture.proxy.configurationDirectory.path))
            #expect(!fixture.setup.certificateInstallationAttempted && fixture.setup.proofURL == nil)
            #expect(!fixture.setup.startForAgent(targetID: fixture.runtime.target.id, proxy: fixture.proxy, traffic: fixture.traffic))
        }
        let status = try payload(await fixture.tool("proxy_simulator_status").call(.object([:])))
        #expect(status["agentStartBlockedReason"] == .string("simulator_isolated_routing_unavailable"))
        #expect(status["isolatedRoutingAvailable"] == .bool(false))
    }

    @Test func directAgentCoordinatorNeverMutatesEvenWithPermissionAndBridge() {
        let fixture = Fixture()
        for allowed in [false, true] {
            for routeThisMac in [false, true] {
                let session = AgentSimulatorSession()
                session.routeThisMac = routeThisMac
                let originalScope = session.scope
                let originalRoutingWrites = session.routingWrites
                let accepted = fixture.setup.startForAgent(targetID: fixture.runtime.target.id, hosts: ["api.example.org"],
                    session: session, bridgePort: 8989,
                    requests: { @MainActor @Sendable in preconditionFailure("Agent setup must not read requests") },
                    agentControlAllowed: allowed)
                #expect(!accepted)
                #expect(fixture.runtime.events.isEmpty && fixture.setup.selectedTargetID == nil)
                #expect(!fixture.setup.isSettingUp && !fixture.setup.hasReservation)
                #expect(session.starts == 0 && session.stops == 0 && session.scopeApplications == 0 && session.restores == 0)
                #expect(session.routeThisMac == routeThisMac && session.routingWrites == originalRoutingWrites)
                #expect(session.scope == originalScope)
            }
        }
    }

    @Test func manualSetupRetainsAgentCancellationForCleanup() async {
        let fixture = Fixture()
        let session = AgentSimulatorSession()
        fixture.setup.selectedTargetID = fixture.runtime.target.id
        let manual = Task { await fixture.setup.setUp(session: session, bridgePort: 8989, requests: { [] }) }
        for _ in 0..<100 where !fixture.setup.isSettingUp { await Task.yield() }
        #expect(fixture.setup.isSettingUp)
        #expect(!(await fixture.setup.cancelForAgent(agentControlAllowed: false)))
        #expect(await fixture.setup.cancelForAgent(agentControlAllowed: true))
        await manual.value
        #expect(!fixture.setup.isSettingUp && !fixture.setup.hasReservation && !session.isActive)
    }

    @Test func failedSetupStatusRetainsExplicitProofAndPersistenceLimits() async throws {
        let fixture = Fixture()
        let session = AgentSimulatorSession()
        fixture.runtime.installError = SimulatorSetupFailure(message: "Certificate rejected")
        fixture.setup.selectedTargetID = fixture.runtime.target.id
        await fixture.setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        let result = await fixture.tool("proxy_simulator_status").call(.object([:]))
        let status = try payload(result)
        #expect(result.isError && status["state"] == .string("failed"))
        #expect(status["steps"]?["certificate"] == .string("failed"))
        #expect(status["certificateInstallationAttempted"] == .bool(true))
        #expect(status["persistentCA"] == .bool(false) && status["proofRequestID"] == .null)
        #expect(status["reservation"]?["active"] == .bool(false))
        #expect(status["reservation"]?["scope"]?.stringValue?.contains("Hakka local") == true)
        #expect(!session.isActive && fixture.runtime.reservation.isReleased)
    }

    @Test func ownedStopPreservesBorrowedCaptureAndRetainsUnconfirmedCleanup() async {
        for borrowed in [true, false] {
            let fixture = Fixture()
            let session = AgentSimulatorSession()
            if borrowed { session.start(bridgePort: 8989); session.routeThisMac = true }
            session.stopSucceeds = false
            fixture.runtime.installError = SimulatorSetupFailure(message: "Certificate rejected")
            fixture.setup.selectedTargetID = fixture.runtime.target.id
            await fixture.setup.setUp(session: session, bridgePort: 8989, requests: { [] })
            if borrowed {
                #expect(session.stops == 0 && session.isActive)
                #expect(await fixture.setup.stopOwnedCapture(agentControlAllowed: true))
                #expect(session.stops == 0)
            } else {
                #expect(fixture.setup.hasReservation)
                #expect(!(await fixture.setup.stopOwnedCapture(agentControlAllowed: true)))
                #expect(fixture.setup.hasReservation && !fixture.runtime.reservation.isReleased)
                session.stopSucceeds = true
                #expect(await fixture.setup.stopOwnedCapture(agentControlAllowed: true))
                #expect(!session.isActive && !fixture.setup.hasReservation)
            }
        }
    }

    @Test func replacementCaptureIsPreservedBeforeReservationMonitorRuns() async {
        let fixture = Fixture()
        let session = AgentSimulatorSession()
        fixture.runtime.installError = SimulatorSetupFailure(message: "Certificate rejected")
        session.stopSucceeds = false
        fixture.setup.selectedTargetID = fixture.runtime.target.id
        await fixture.setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(fixture.setup.hasReservation && fixture.setup.ownsSetupCapture)
        let originalStops = session.stops
        session.identity = NSObject()
        session.routeThisMac = true
        #expect(!fixture.setup.ownsSetupCapture && !fixture.setup.isSetupCaptureCurrent)
        #expect(await fixture.setup.stopOwnedCapture(agentControlAllowed: true))
        #expect(session.stops == originalStops && session.isActive && session.routeThisMac)
        #expect(fixture.runtime.reservation.isReleased)
    }

    @Test func defaultSetupScopesOnlyProofHostAndRestoresOwnedDraft() async {
        let fixture = Fixture()
        let session = AgentSimulatorSession()
        session.scope = TLSHostScope()
        let original = session.scope
        fixture.runtime.installError = SimulatorSetupFailure(message: "Certificate rejected")
        fixture.setup.selectedTargetID = fixture.runtime.target.id
        await fixture.setup.setUp(session: session, bridgePort: 8989, requests: { [] })
        #expect(session.launchedScope?.mode == .allowOnly)
        #expect(session.launchedScope?.enabledHosts == ["example.com"])
        #expect(session.scope == original && session.restores == 1)
    }

    @Test func borrowedBroadTLSCaptureCannotBeMutatedBySetup() async {
        let fixture = Fixture()
        let session = AgentSimulatorSession()
        session.scope = TLSHostScope()
        session.start(bridgePort: 8989)
        let accepted = fixture.setup.startForAgent(targetID: fixture.runtime.target.id, session: session,
                                                   bridgePort: 8989, requests: { [] }, agentControlAllowed: true)
        #expect(!accepted && fixture.runtime.events.isEmpty)
        #expect(session.starts == 1 && session.stops == 0 && session.scope.mode == .bypass)
    }

    @Test func invalidHostArgumentsDoNotStartOrMutate() async {
        let fixture = Fixture()
        fixture.proxy.allowAgentControl = true
        let invalid: [MCPValue] = [.string("api.example.com"), .array([.number(1)]), .array([.string("")]),
                                  .array([.string(".*")]), .array(Array(repeating: .string("api.example.com"), count: 33))]
        for hosts in invalid {
            let result = await fixture.tool("proxy_simulator_setup").call(.object(["targetID": .string(fixture.runtime.target.id), "hosts": hosts]))
            #expect(result.isError)
        }
        #expect(fixture.runtime.events.isEmpty && fixture.setup.selectedTargetID == nil)
    }

    @Test func restoresExactPersistedPresenceAndSeparateUserDraft() throws {
        for originallyPresent in [true, false] {
            let defaults = UserDefaults(suiteName: "hakka-tls-setup-tests-" + UUID().uuidString)!
            let saved = TLSHostScope(mode: .allowOnly, entries: [TLSHostScopeEntry(host: "saved.example.org")])
            let savedData = try JSONEncoder().encode(saved)
            if originallyPresent { defaults.set(savedData, forKey: "hakka.proxy.tlsScope") }
            let proxy = ProxyCaptureModel(defaults: defaults)
            let draft = TLSHostScope(mode: .bypass, entries: [TLSHostScopeEntry(host: "draft.example.org")])
            proxy.tlsHostScope = draft
            let snapshot = try #require(proxy.snapshotSetupTLSConfiguration())
            let temporary = try #require(SimulatorCaptureSetup.captureScope(hosts: ["api.example.net"]))
            proxy.applySetupTLSHostScope(temporary)
            defaults.set(try JSONEncoder().encode(temporary), forKey: "hakka.proxy.tlsScope")
            proxy.restoreSetupTLSConfiguration(snapshot, appliedScope: temporary)
            #expect(proxy.tlsHostScope == draft)
            #expect(defaults.data(forKey: "hakka.proxy.tlsScope") == (originallyPresent ? savedData : nil))
        }
    }

    private func payload(_ result: MCPToolResult) throws -> MCPValue {
        let text = try #require(result.content.first?["text"]?.stringValue)
        return try JSONDecoder().decode(MCPValue.self, from: Data(text.utf8))
    }

    @MainActor private final class Fixture {
        let runtime = AgentSimulatorRuntime()
        let setup: SimulatorCaptureSetup
        let proxy: ProxyCaptureModel
        let traffic = TrafficModel()
        init() {
            setup = SimulatorCaptureSetup(runtime: runtime)
            proxy = ProxyCaptureModel(defaults: UserDefaults(suiteName: "hakka-agent-tests-" + UUID().uuidString)!,
                                      directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        }
        func tool(_ name: String) -> any MCPTool {
            NativeSimulatorSetupTool.tools(setup: setup, proxy: proxy, traffic: traffic).first { $0.name == name }!
        }
    }
}

@MainActor
private final class AgentSimulatorRuntime: SimulatorSetupRunning {
    let target = SimulatorSetupTarget(id: UUID().uuidString, name: "Test iPhone", state: "Shutdown")
    let reservation = SimulatorSetupReservation()
    var events: [String] = []
    var discoveryError: (any Error)?
    var installError: (any Error)?
    func discoverTargets() async throws -> [SimulatorSetupTarget] {
        events.append("discover")
        if let discoveryError { throw discoveryError }
        return [target]
    }
    func reserve(targetID _: String, directory _: URL) throws -> SimulatorSetupReservation { events.append("reserve"); return reservation }
    func boot(targetID _: String) async throws { events.append("boot") }
    func certificateFingerprint(path _: String) throws -> String { "test-public-ca-sha256" }
    func installCertificate(targetID _: String, path _: String) async throws {
        events.append("install")
        if let installError { throw installError }
    }
    func openSafari(targetID _: String, url _: URL) async throws { events.append("open") }
    func pause() async throws { try Task.checkCancellation(); await Task.yield() }
}

@MainActor
private final class AgentSimulatorSession: SimulatorCaptureSession {
    var scope = TLSHostScope(mode: .allowOnly, entries: [TLSHostScopeEntry(host: "example.com")])
    var launchedScope: TLSHostScope?
    var restores = 0
    var scopeApplications = 0
    var routingWrites = 0
    var captureTLSHostScope: TLSHostScope { isActive ? (launchedScope ?? scope) : scope }
    func snapshotSetupTLSConfiguration() -> ProxyTLSConfigurationSnapshot? { ProxyTLSConfigurationSnapshot(draft: scope, persistedValue: nil) }
    func applySetupTLSHostScope(_ value: TLSHostScope) { scopeApplications += 1; scope = value }
    func restoreSetupTLSConfiguration(_ snapshot: ProxyTLSConfigurationSnapshot, appliedScope: TLSHostScope) { scope = snapshot.draft; restores += 1 }
    var identity = NSObject()
    var setupCaptureIdentity: ObjectIdentifier? { ObjectIdentifier(identity) }
    var state = ProxyCaptureModel.State.stopped
    var isActive = false
    var routeThisMac = false { didSet { routingWrites += 1 } }
    var isSystemProxyRoutingActive = false
    var isSystemProxyRoutingRecoveryPending = false
    var isRecoveringSystemProxyRouting = false
    let configurationDirectory = FileManager.default.temporaryDirectory
    var certificatePath: String? = "/tmp/test-public-ca.pem"
    var message = "Test capture"
    var stopSucceeds = true
    var starts = 0
    var stops = 0
    func start(bridgePort _: UInt16) { launchedScope = scope; starts += 1; state = .running; isActive = true; isSystemProxyRoutingActive = true }
    func shutdown() async -> Bool {
        stops += 1
        if stopSucceeds { state = .stopped; isActive = false; isSystemProxyRoutingActive = false }
        return stopSucceeds
    }
}
