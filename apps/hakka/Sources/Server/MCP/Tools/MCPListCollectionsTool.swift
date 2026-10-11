import Foundation
import HakkaCore

/// Summarizes the collections currently open in the desktop app.
public struct MCPListCollectionsTool: MCPTool {
    public let name = "list_collections"
    public let description =
        "List the API-client collections currently open in Hakka for macOS — each one's saved-request and folder counts, " +
        "not live traffic. Empty when no collection directory is open yet."
    public let inputSchema: MCPValue = .object(["type": .string("object"), "properties": .object([:])])

    private let source: MCPCollectionSource

    public init(source: MCPCollectionSource) {
        self.source = source
    }

    public func call(_ arguments: MCPValue) async -> MCPToolResult {
        let loads = await source.loadAll()
        let entries: [MCPValue] = loads.map { load in
            if let collection = load.collection {
                let counts = MCPCollectionSource.countNodes(collection.nodes)
                return .object([
                    "id": .string(collection.id),
                    "name": .string(collection.name),
                    "directory": .string(load.directory.path),
                    "requestCount": .number(Double(counts.requests)),
                    "folderCount": .number(Double(counts.folders)),
                    "notes": collection.notes.map(MCPValue.string) ?? .null,
                ])
            } else {
                return .object([
                    "directory": .string(load.directory.path),
                    "error": .string(load.loadError ?? "unknown error"),
                ])
            }
        }
        return .json(.object(["count": .number(Double(entries.count)), "collections": .array(entries)]))
    }
}
