import Foundation
import HakkaCommon

/// Mirrors `hakka mcp`'s `list_requests` in name and argument shape (`limit`,
/// `offset`), so an agent already written against the CLI's MCP server works
/// against this one unchanged. See `MCPTrafficSource`'s doc comment for why
/// there is no `unredacted` flag here.
public struct MCPListRequestsTool: MCPTool {
    public let name = "list_requests"
    public let description =
        "List captured HTTP requests from this Mac's live traffic, newest first. Use limit/offset to page " +
        "through results (default 50, max 500)."
    public let inputSchema: MCPValue = .object([
        "type": .string("object"),
        "properties": .object([
            "limit": .object([
                "type": .string("integer"), "minimum": .number(1), "maximum": .number(500), "default": .number(50),
                "description": .string("Max results to return"),
            ]),
            "offset": .object([
                "type": .string("integer"), "minimum": .number(0), "default": .number(0),
                "description": .string("Skip N results, for pagination"),
            ]),
        ]),
        "additionalProperties": .bool(false),
    ])

    private let source: MCPTrafficSource

    public init(source: MCPTrafficSource) {
        self.source = source
    }

    public func call(_ arguments: MCPValue) async -> MCPToolResult {
        let limit = min(max(arguments["limit"]?.intValue ?? 50, 1), 500)
        let offset = max(arguments["offset"]?.intValue ?? 0, 0)

        // `TrafficStore.all()` returns oldest-first; this tool's contract
        // (and the CLI equivalent it mirrors) is newest-first.
        let newestFirst = Array(await source.allRequests().reversed())
        let total = newestFirst.count
        let page: [NetworkRequest] = offset < total ? Array(newestFirst[offset..<min(offset + limit, total)]) : []

        return .json(.object([
            "total": .number(Double(total)),
            "offset": .number(Double(offset)),
            "count": .number(Double(page.count)),
            "requests": .array(page.map { MCPValue.encoded($0) }),
        ]))
    }
}
