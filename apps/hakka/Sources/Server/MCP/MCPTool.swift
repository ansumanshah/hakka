import Foundation

/// The result of one `tools/call` invocation, in MCP's `CallToolResult`
/// shape: a list of content blocks (this server only ever produces one text
/// block — JSON, matching the CLI's `hakka mcp` tools) plus `isError`.
///
/// Per the MCP spec, a *tool execution* failure (not found, bad argument,
/// ...) is reported this way — `isError: true` inside an otherwise normal
/// JSON-RPC success response — rather than as a JSON-RPC-level error. That
/// is what lets the calling agent see the failure and react to it, instead
/// of the failure looking like a broken protocol call. See
/// `MCPRequestHandler`'s `tools/call` case for the split between this and a
/// real JSON-RPC error (unknown tool name).
public struct MCPToolResult: Sendable {
    public let content: [MCPValue]
    public let isError: Bool

    public init(content: [MCPValue], isError: Bool = false) {
        self.content = content
        self.isError = isError
    }

    /// The common case: one JSON text block, built the same way `toolResult.ts`
    /// builds the CLI's — `JSON.stringify(payload)` there, `payload.jsonData()`
    /// here.
    public static func json(_ payload: MCPValue, isError: Bool = false) -> MCPToolResult {
        let text = String(data: payload.jsonData(), encoding: .utf8) ?? "null"
        return MCPToolResult(content: [.object(["type": .string("text"), "text": .string(text)])], isError: isError)
    }

    /// Encoded as `MCPResponseBuilder` builds every other result: an
    /// `MCPValue` tree, so `MCPRequestHandler` can drop it straight into the
    /// JSON-RPC envelope's `result` field.
    var asMCPValue: MCPValue {
        var fields: [String: MCPValue] = ["content": .array(content)]
        if isError { fields["isError"] = .bool(true) }
        return .object(fields)
    }
}

/// One MCP tool: a name, a description, a JSON-Schema `inputSchema`, and an
/// async `call`. Declarative and independently testable — a tool is
/// constructed with whatever data source it reads (`MCPTrafficSource`,
/// `MCPCollectionSource`, ...) and its `call` can be driven directly in a
/// unit test with no JSON-RPC envelope involved at all.
public protocol MCPTool: Sendable {
    var name: String { get }
    var description: String { get }
    /// A JSON-Schema object (draft matches what `tools/list` advertises to
    /// the client, `{"type": "object", "properties": {...}}`), describing
    /// the shape `call`'s `arguments` expects.
    var inputSchema: MCPValue { get }
    /// `arguments` is `tools/call`'s `params.arguments` field verbatim —
    /// `.object([:])` when the client omitted it. A tool is responsible for
    /// its own argument validation and reports a bad argument as
    /// `MCPToolResult(isError: true)`, not by throwing — see
    /// `MCPToolResult`'s doc comment for why that split exists.
    func call(_ arguments: MCPValue) async -> MCPToolResult

    /// `tools/list`'s per-tool entry.
    var listEntry: MCPValue { get }
}

extension MCPTool {
    public var listEntry: MCPValue {
        .object(["name": .string(name), "description": .string(description), "inputSchema": inputSchema])
    }
}
