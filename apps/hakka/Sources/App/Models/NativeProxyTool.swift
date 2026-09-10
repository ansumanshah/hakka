import Foundation
import HakkaServer

/// Native MCP controls operate the same model as the proxy window.
struct NativeProxyTool: MCPTool {
    let name: String
    let description: String
    let inputSchema: MCPValue = .object(["type": .string("object"), "properties": .object([:]), "additionalProperties": .bool(false)])
    let action: @MainActor @Sendable () async -> MCPToolResult

    func call(_ arguments: MCPValue) async -> MCPToolResult { await action() }

    @MainActor static func tools(proxy: ProxyCaptureModel, traffic: TrafficModel) -> [any MCPTool] {
        [
            NativeProxyTool(name: "proxy_status", description: "Read the native Proxy Capture window status and configuration.") {
                snapshot(proxy)
            },
            NativeProxyTool(name: "proxy_start", description: "Start capture using the native window configuration. Requires its Allow agents toggle.") {
                guard proxy.allowAgentControl else { return denied() }
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
            "records": .number(Double(proxy.capturedCount)),
            "publicCertificatePath": proxy.certificatePath.map(MCPValue.string) ?? .null,
        ]), isError: proxy.state == .failed)
    }

    private static func denied() -> MCPToolResult {
        .json(.object(["error": .string("Enable Allow agents to start and stop this proxy in the Proxy Capture window.")]), isError: true)
    }
}
