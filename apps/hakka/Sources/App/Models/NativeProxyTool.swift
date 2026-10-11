import Foundation
import HakkaServer

/// Native MCP controls operate the same model as the proxy window.
struct NativeProxyTool: MCPTool {
    let name: String
    let description: String
    let inputSchema: MCPValue = .object(["type": .string("object"), "properties": .object([:]), "additionalProperties": .bool(false)])
    let action: @MainActor @Sendable () async -> MCPToolResult

    func call(_ arguments: MCPValue) async -> MCPToolResult {
        guard arguments.objectValue?.isEmpty == true else {
            return .json(.object(["error": .string("Expected an object with no properties.")]), isError: true)
        }
        return await action()
    }

    @MainActor static func tools(proxy: ProxyCaptureModel, traffic: TrafficModel) -> [any MCPTool] {
        [
            NativeProxyTool(name: "proxy_status", description: "Read the native Proxy Capture window status and configuration.") {
                snapshot(proxy)
            },
            NativeProxyTool(name: "proxy_start", description: "Start capture using the native window configuration. Requires its Allow agents toggle and routing limited to explicitly configured clients.") {
                guard proxy.allowAgentControl else { return denied() }
                if let reason = agentStartBlockedReason(proxy) {
                    return .json(.object([
                        "error": .string("Agent capture cannot change Mac-wide proxy routing or start while its restoration is unconfirmed."),
                        "state": .string("unavailable"),
                        "agentStartBlockedReason": .string(reason),
                        "routingScope": .string(routingScope(proxy)),
                        "isolatedRoutingAvailable": .bool(false),
                    ]), isError: true)
                }
                guard let port = traffic.boundPort, traffic.isRunning else {
                    return .json(.object(["error": .string("The desktop traffic bridge is not running.")]), isError: true)
                }
                proxy.start(bridgePort: port)
                for _ in 0..<150 {
                    if proxy.state != .starting { break }
                    do { try await Task.sleep(for: .milliseconds(100)) } catch { break }
                }
                return snapshot(proxy)
            },
            NativeProxyTool(name: "proxy_stop", description: "Stop native proxy capture and wait for shutdown. Requires its Allow agents toggle.") {
                guard proxy.allowAgentControl else { return denied() }
                guard await proxy.shutdown() else {
                    return .json(.object(["error": .string(proxy.message)]), isError: true)
                }
                return snapshot(proxy)
            },
        ]
    }

    @MainActor private static func snapshot(_ proxy: ProxyCaptureModel) -> MCPToolResult {
        .json(.object([
            "state": .string(String(describing: proxy.state)),
            "message": .string(proxy.message),
            "port": .number(Double(proxy.port)),
            "allowLAN": .bool(proxy.allowLAN),
            "agentControlAllowed": .bool(proxy.allowAgentControl),
            "routingScope": .string(routingScope(proxy)),
            "routingRecoveryChecked": .bool(proxy.isSystemProxyRoutingRecoveryChecked),
            "routeThisMac": .bool(proxy.routeThisMac),
            "systemProxyRoutingActive": .bool(proxy.isSystemProxyRoutingActive),
            "systemProxyRoutingRecoveryPending": .bool(proxy.isSystemProxyRoutingRecoveryPending),
            "isolatedRoutingAvailable": .bool(agentStartBlockedReason(proxy) == nil),
            "agentStartBlockedReason": agentStartBlockedReason(proxy).map(MCPValue.string) ?? .null,
            "records": .number(Double(proxy.capturedCount)),
            "publicCertificatePath": proxy.certificatePath.map(MCPValue.string) ?? .null,
        ]), isError: proxy.state == .failed)
    }

    @MainActor private static func routingScope(_ proxy: ProxyCaptureModel) -> String {
        proxy.routeThisMac || proxy.isSystemProxyRoutingActive ? "mac_system_proxy" : "configured_clients_only"
    }

    @MainActor private static func agentStartBlockedReason(_ proxy: ProxyCaptureModel) -> String? {
        if proxy.routeThisMac { return "mac_system_proxy_routing_disallowed" }
        if !proxy.isSystemProxyRoutingRecoveryChecked || proxy.isSystemProxyRoutingActive || proxy.isSystemProxyRoutingRecoveryPending || proxy.isRecoveringSystemProxyRouting {
            return "mac_system_proxy_restoration_unconfirmed"
        }
        return nil
    }

    private static func denied() -> MCPToolResult {
        .json(.object(["error": .string("Enable Allow agents to start and stop this proxy in the Proxy Capture window.")]), isError: true)
    }
}
