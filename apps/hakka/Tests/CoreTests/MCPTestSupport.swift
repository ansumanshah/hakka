import Foundation

@testable import HakkaServer

/// Shared helpers for the `MCP*Tests` files — decoding an `MCPToolResult`'s
/// JSON text content back into an `MCPValue` for assertions, and reading a
/// JSON array out of one.
func decodeJSON(_ result: MCPToolResult) -> MCPValue {
    let text = result.content.first?["text"]?.stringValue ?? "null"
    return (try? JSONDecoder().decode(MCPValue.self, from: Data(text.utf8))) ?? .null
}

extension MCPValue {
    var arrayValue: [MCPValue]? {
        guard case let .array(values) = self else { return nil }
        return values
    }
}
