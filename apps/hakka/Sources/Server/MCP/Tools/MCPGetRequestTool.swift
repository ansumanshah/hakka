import Foundation
import HakkaCommon

/// Mirrors `hakka mcp`'s `get_request` in name and argument shape.
public struct MCPGetRequestTool: MCPTool {
    public let name = "get_request"
    public let description = "Get a single captured live-traffic request by its id."
    public let inputSchema: MCPValue = .object([
        "type": .string("object"),
        "properties": .object(["id": .object(["type": .string("string"), "description": .string("The request id")])]),
        "required": .array([.string("id")]),
        "additionalProperties": .bool(false),
    ])

    private let source: MCPTrafficSource

    public init(source: MCPTrafficSource) {
        self.source = source
    }

    public func call(_ arguments: MCPValue) async -> MCPToolResult {
        guard let id = arguments["id"]?.stringValue, !id.isEmpty else {
            return .json(.object(["error": .string("invalid_params"), "message": .string("`id` is required")]), isError: true)
        }
        guard let request = await source.request(id: id) else {
            return .json(.object(["error": .string("not_found"), "id": .string(id)]), isError: true)
        }
        return .json(MCPValue.encoded(request))
    }
}
