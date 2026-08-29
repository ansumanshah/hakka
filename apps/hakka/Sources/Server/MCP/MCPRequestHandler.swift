import Foundation

/// Protocol versions this server understands, newest first. Per the MCP
/// spec's negotiation rule: if the client's requested `protocolVersion` is
/// one of these, echo it back; otherwise respond with `latest` (the spec
/// says "This SHOULD be the latest version supported by the server").
enum MCPProtocolVersion {
    static let supported = ["2025-06-18", "2025-03-26", "2024-11-05"]
    static let latest = supported[0]
}

/// The result of handling one JSON-RPC request: either a response body to
/// send back, or `noResponse` for a notification (a request with no `id`) —
/// per spec, "The Server MUST NOT reply to a Notification". The HTTP layer
/// maps `noResponse` to a 202 with an empty body rather than inventing a
/// JSON-RPC envelope nobody asked for.
public enum MCPHandleResult: Sendable, Equatable {
    case response(Data)
    case noResponse
}

/// Dispatches one JSON-RPC 2.0 request to `initialize`, `tools/list`, or
/// `tools/call` and builds the response — the whole MCP surface this server
/// exposes. An actor so `MCPHTTPServer` can hand it concurrent connections
/// without any handler-side locking; it holds no mutable state of its own
/// beyond `registry`, which is itself an actor.
///
/// This is a stateless request/response transport: unlike MCP's
/// "Streamable HTTP" transport (session IDs, an SSE stream, a required
/// `initialize` handshake before anything else is accepted), every POST
/// here is handled independently with no session tracked between requests.
/// A GUI app has no natural place to keep a long-lived per-client session
/// (there is no persistent connection the way stdio or a WebSocket gives
/// you one), and a coding agent driving this tool set only ever needs
/// request/response semantics — so `tools/list`/`tools/call` work whether
/// or not the caller sent `initialize` first, which a stricter session-aware
/// server would reject.
public actor MCPRequestHandler {
    private let registry: MCPToolRegistry
    private let serverName: String
    private let serverVersion: String

    public init(registry: MCPToolRegistry, serverName: String = "hakka-desktop", serverVersion: String = "0.1.0") {
        self.registry = registry
        self.serverName = serverName
        self.serverVersion = serverVersion
    }

    /// `body` is one HTTP request's raw bytes. Never throws — every failure
    /// mode (bad JSON, unknown method, ...) is represented in the returned
    /// result instead, matching this codebase's "parse boundary never
    /// throws" convention (`parseBridgeFrame`).
    public func handle(_ body: Data) async -> MCPHandleResult {
        guard let request = MCPParsedRequest.parse(body) else {
            return .response(MCPResponseBuilder.failure(id: .null, code: MCPErrorCode.parseError, message: "Parse error"))
        }
        guard request.isValidRequest, let method = request.method else {
            return .response(
                MCPResponseBuilder.failure(id: request.id, code: MCPErrorCode.invalidRequest, message: "Invalid Request")
            )
        }
        if request.isNotification {
            // `notifications/initialized` is the one the MCP client
            // handshake actually sends; any other notification-shaped
            // request (no `id`) is accepted the same way — there is
            // nothing meaningful to reply with either way.
            return .noResponse
        }

        switch method {
        case "initialize":
            return .response(MCPResponseBuilder.success(id: request.id, result: initializeResult(request.params)))
        case "tools/list":
            let tools = await registry.list()
            return .response(
                MCPResponseBuilder.success(id: request.id, result: .object(["tools": .array(tools.map(\.listEntry))]))
            )
        case "tools/call":
            return await handleToolsCall(id: request.id, params: request.params)
        default:
            return .response(
                MCPResponseBuilder.failure(
                    id: request.id, code: MCPErrorCode.methodNotFound, message: "Method not found: \(method)"
                )
            )
        }
    }

    private func initializeResult(_ params: MCPValue) -> MCPValue {
        let requested = params["protocolVersion"]?.stringValue
        let negotiated = requested.flatMap { MCPProtocolVersion.supported.contains($0) ? $0 : nil } ?? MCPProtocolVersion.latest
        return .object([
            "protocolVersion": .string(negotiated),
            "capabilities": .object(["tools": .object([:])]),
            "serverInfo": .object(["name": .string(serverName), "version": .string(serverVersion)]),
        ])
    }

    private func handleToolsCall(id: MCPValue, params: MCPValue) async -> MCPHandleResult {
        guard let name = params["name"]?.stringValue, !name.isEmpty else {
            return .response(
                MCPResponseBuilder.failure(id: id, code: MCPErrorCode.invalidParams, message: "`name` is required")
            )
        }
        guard let tool = await registry.tool(named: name) else {
            return .response(
                MCPResponseBuilder.failure(id: id, code: MCPErrorCode.invalidParams, message: "Unknown tool: \(name)")
            )
        }
        let arguments = params["arguments"] ?? .object([:])
        let result = await tool.call(arguments)
        return .response(MCPResponseBuilder.success(id: id, result: result.asMCPValue))
    }
}
