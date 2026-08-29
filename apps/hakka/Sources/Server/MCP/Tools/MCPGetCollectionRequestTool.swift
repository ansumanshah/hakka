import Foundation
import HakkaCore

/// The other half of the collections surface — reads one full `RequestSpec`
/// (method, URL, headers, body, auth, assertions, captures, scripts, ...)
/// by id, exactly what a code-generation or replay agent needs and
/// `hakka mcp` structurally cannot provide.
public struct MCPGetCollectionRequestTool: MCPTool {
    public let name = "get_collection_request"
    public let description =
        "Read one saved request spec from an open collection by its id. Pass collectionId to disambiguate " +
        "when more than one collection is open; omitted, every open collection is searched."
    public let inputSchema: MCPValue = .object([
        "type": .string("object"),
        "properties": .object([
            "id": .object(["type": .string("string"), "description": .string("The request's id within its collection")]),
            "collectionId": .object([
                "type": .string("string"), "description": .string("Restrict the search to one collection's id"),
            ]),
        ]),
        "required": .array([.string("id")]),
        "additionalProperties": .bool(false),
    ])

    private let source: MCPCollectionSource

    public init(source: MCPCollectionSource) {
        self.source = source
    }

    public func call(_ arguments: MCPValue) async -> MCPToolResult {
        guard let id = arguments["id"]?.stringValue, !id.isEmpty else {
            return .json(.object(["error": .string("invalid_params"), "message": .string("`id` is required")]), isError: true)
        }
        let collectionId = arguments["collectionId"]?.stringValue
        guard let spec = await source.requestSpec(id: id, collectionId: collectionId) else {
            return .json(.object(["error": .string("not_found"), "id": .string(id)]), isError: true)
        }
        return .json(MCPValue.encoded(spec))
    }
}
