import Foundation
import HakkaServer

/// Bounded native controls reuse the desktop Simulator workflow and its capture owner.
struct NativeSimulatorSetupTool: MCPTool {
    let name: String
    let description: String
    let inputSchema: MCPValue
    let action: @MainActor @Sendable (MCPValue) async -> MCPToolResult

    func call(_ arguments: MCPValue) async -> MCPToolResult { await action(arguments) }

    @MainActor static func tools(setup: SimulatorCaptureSetup, proxy: ProxyCaptureModel, traffic: TrafficModel) -> [any MCPTool] {
        [
            Self(name: "proxy_simulator_targets", description: "List available iOS Simulators with exact target IDs and boot status. Read only.", inputSchema: schema()) { arguments in
                guard validEmpty(arguments) else { return failure("Expected an object with no properties.") }
                await setup.refreshTargets()
                return .json(.object([
                    "targets": .array(setup.targets.map { .object(["targetID": .string($0.id), "name": .string($0.name), "state": .string($0.state), "isBooted": .bool($0.isBooted)]) }),
                    "isRefreshing": .bool(setup.isRefreshingTargets),
                    "message": .string(setup.message),
                    "needsManualSetup": .bool(setup.needsManualSetup),
                    "routingScope": .string("mac_system_proxy"),
                    "isolatedRoutingAvailable": .bool(false),
                    "agentStartBlockedReason": .string(SimulatorCaptureSetup.agentStartBlockedReason),
                ]), isError: setup.needsManualSetup && setup.targets.isEmpty)
            },
            Self(name: "proxy_simulator_setup", description: "Unavailable: this workflow requires Mac-wide proxy routing and isolated Simulator routing is not implemented. Agent calls never discover, reserve, boot, install trust, or start capture. Use the explicit manual GUI workflow.", inputSchema: schema(target: true)) { arguments in
                guard let values = arguments.objectValue, Set(values.keys).isSubset(of: ["targetID", "hosts"]),
                      let id = values["targetID"]?.stringValue, UUID(uuidString: id) != nil else {
                    return failure("Provide targetID as an exact Simulator UUID string and optional hosts as literal TLS hosts.")
                }
                let hosts: [String]
                if let value = values["hosts"] {
                    guard case let .array(entries) = value, entries.allSatisfy({ $0.stringValue != nil }) else {
                        return failure("hosts must be an array of literal host strings.")
                    }
                    hosts = entries.compactMap(\.stringValue)
                } else { hosts = [] }
                guard SimulatorCaptureSetup.captureScope(hosts: hosts) != nil else { return failure("Use at most 32 valid literal TLS hosts; regular expressions and empty hosts are unsupported.") }
                guard proxy.allowAgentControl else { return denied() }
                return .json(.object([
                    "error": .string(SimulatorCaptureSetup.agentStartUnavailableMessage),
                    "state": .string("unavailable"),
                    "routingScope": .string("mac_system_proxy"),
                    "isolatedRoutingAvailable": .bool(false),
                    "agentStartBlockedReason": .string(SimulatorCaptureSetup.agentStartBlockedReason),
                ]), isError: true)
            },
            Self(name: "proxy_simulator_status", description: "Read per-step setup state, target HTTPS proof, public CA fingerprint and persistence, and Hakka local reservation scope. Does not prove capture for every app.", inputSchema: schema()) { arguments in
                guard validEmpty(arguments) else { return failure("Expected an object with no properties.") }
                return snapshot(setup, proxy: proxy)
            },
            Self(name: "proxy_simulator_stop", description: "Stop only capture started by Simulator setup and await routing cleanup. Requires Allow agents. Preserves borrowed capture and installed CA trust.", inputSchema: schema()) { arguments in
                guard validEmpty(arguments) else { return failure("Expected an object with no properties.") }
                guard proxy.allowAgentControl else { return denied() }
                guard await setup.stopOwnedCapture(agentControlAllowed: proxy.allowAgentControl) else {
                    return failure("Setup does not own this capture, or routing cleanup remains unconfirmed. Check Simulator status and stop the desktop capture through its owner.")
                }
                return snapshot(setup, proxy: proxy)
            },
            Self(name: "proxy_simulator_cancel", description: "Cancel active Simulator setup and await its cleanup. Requires Allow agents. Installed CA trust persists. Does not start a new setup or stop unrelated capture.", inputSchema: schema()) { arguments in
                guard validEmpty(arguments) else { return failure("Expected an object with no properties.") }
                guard proxy.allowAgentControl else { return denied() }
                _ = await setup.cancelForAgent(agentControlAllowed: proxy.allowAgentControl)
                return snapshot(setup, proxy: proxy)
            },
        ]
    }

    private static func schema(target: Bool = false) -> MCPValue {
        var fields: [String: MCPValue] = [
            "type": .string("object"),
            "properties": target ? .object(["targetID": .object(["type": .string("string"), "format": .string("uuid")]), "hosts": .object(["type": .string("array"), "maxItems": .number(32), "items": .object(["type": .string("string")])])]) : .object([:]),
            "additionalProperties": .bool(false),
        ]
        if target { fields["required"] = .array([.string("targetID")]) }
        return .object(fields)
    }

    private static func validEmpty(_ arguments: MCPValue) -> Bool { arguments.objectValue?.isEmpty == true }

    @MainActor private static func snapshot(_ setup: SimulatorCaptureSetup, proxy: ProxyCaptureModel) -> MCPToolResult {
        let checks = [setup.engine, setup.routing, setup.certificate, setup.https, setup.delivery]
        let failed = checks.contains(.failed) || setup.needsManualSetup
        let complete = checks.allSatisfy { $0 == .complete }
        let captureStopped = !setup.hasReservation || !setup.isSetupCaptureCurrent || proxy.state != .running
        let state = setup.isSettingUp ? "setting_up" : failed ? "failed" : complete ? (captureStopped ? "completed_capture_stopped" : "complete") : "idle"
        return .json(.object([
            "state": .string(state), "message": .string(setup.message),
            "targetID": (setup.reservedTargetID ?? setup.selectedTargetID).map(MCPValue.string) ?? .null,
            "agentControlAllowed": .bool(proxy.allowAgentControl),
            "routingScope": .string("mac_system_proxy"),
            "isolatedRoutingAvailable": .bool(false),
            "agentStartBlockedReason": .string(SimulatorCaptureSetup.agentStartBlockedReason),
            "captureState": .string(String(describing: proxy.state)),
            "activeCaptureHosts": .array((proxy.activeTLSHostScope?.enabledHosts ?? []).map(MCPValue.string)),
            "setupAttemptCaptureHosts": .array(setup.activeCaptureHosts.map(MCPValue.string)),
            "tlsScope": .string(proxy.activeTLSHostScope?.mode.rawValue ?? "inactive"),
            "macRoutingScope": .string("This Simulator workflow requires Mac-wide HTTP and HTTPS proxy routing. TLS host selection limits decryption, not routing. Isolated Simulator routing is not implemented."),
            "systemProxyRoutingActive": .bool(proxy.isSystemProxyRoutingActive),
            "proofIsHistorical": .bool(setup.proofRequestID != nil),
            "steps": .object(["engine": check(setup.engine), "routing": check(setup.routing), "certificate": check(setup.certificate), "https": check(setup.https), "delivery": check(setup.delivery)]),
            "publicCAFingerprint": setup.caFingerprint.map(MCPValue.string) ?? .null,
            "persistentCA": .bool(setup.certificatePersists),
            "certificateInstallationAttempted": .bool(setup.certificateInstallationAttempted),
            "proofRequestID": setup.proofRequestID.map(MCPValue.string) ?? .null,
            "proofURL": setup.proofURL.map { .string($0.absoluteString) } ?? .null,
            "proofScope": .string("One selected Simulator Safari HTTPS test request from this setup attempt; historical proof does not verify a later capture generation. Other apps are untested."),
            "reservation": .object(["active": .bool(setup.hasReservation), "ownsCapture": .bool(setup.ownsSetupCapture), "targetID": setup.reservedTargetID.map(MCPValue.string) ?? .null,
                                    "scope": .string("Hakka local Simulator setup only; no cross-app or Noodle lease protection.")]),
            "needsManualSetup": .bool(setup.needsManualSetup),
        ]), isError: !setup.isSettingUp && failed)
    }

    private static func check(_ value: SimulatorCaptureSetup.CheckState) -> MCPValue { .string(String(describing: value)) }
    private static func failure(_ message: String) -> MCPToolResult { .json(.object(["error": .string(message)]), isError: true) }
    private static func denied() -> MCPToolResult { failure("Enable Allow agents in Proxy Capture before Simulator setup or cancellation.") }
}
