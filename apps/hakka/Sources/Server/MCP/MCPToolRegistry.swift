import Foundation

/// Holds the set of tools this MCP server advertises and dispatches
/// `tools/call` to. An actor rather than a plain struct because `tools/list`
/// and `tools/call` both read it from `MCPRequestHandler`, which is itself
/// an actor — matching `CollectionStore`'s "actor so concurrent access
/// serializes instead of racing" rationale, even though today nothing
/// mutates a registry after server startup. Registration order is
/// preserved so `tools/list` output is stable/predictable rather than
/// dictionary-order-dependent.
public actor MCPToolRegistry {
    private var toolsByName: [String: any MCPTool] = [:]
    private var orderedNames: [String] = []

    /// Assigns `toolsByName`/`orderedNames` directly rather than calling
    /// `register` — an actor initializer runs before `self` is fully
    /// formed, so it can touch stored properties synchronously, but calling
    /// an actor-isolated *method* (even this actor's own) from inside
    /// `init` would still be the normal async, cross-isolation call.
    public init(tools: [any MCPTool] = []) {
        for tool in tools {
            if toolsByName[tool.name] == nil {
                orderedNames.append(tool.name)
            }
            toolsByName[tool.name] = tool
        }
    }

    public func register(_ tool: any MCPTool) {
        if toolsByName[tool.name] == nil {
            orderedNames.append(tool.name)
        }
        toolsByName[tool.name] = tool
    }

    /// All registered tools, in registration order.
    public func list() -> [any MCPTool] {
        orderedNames.compactMap { toolsByName[$0] }
    }

    public func tool(named name: String) -> (any MCPTool)? {
        toolsByName[name]
    }
}
