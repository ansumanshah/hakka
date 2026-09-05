import Foundation

/// The native MCP server this desktop app hosts: composes the tool
/// registry, the JSON-RPC handler, and the HTTP transport, and exposes just
/// `start`/`stop`. A plain `Sendable` struct, not another actor — every
/// stored property is itself an actor reference (`MCPToolRegistry`,
/// `MCPRequestHandler`, `MCPHTTPServer`), so there is no mutable state of
/// this type's own to protect; wrapping them in a further actor would only
/// add an extra hop.
///
/// Off by default: constructing an `MCPServer` does not open a socket —
/// `start()` is the one call that does, and it is never invoked
/// automatically. The app layer decides when (a Settings toggle, most
/// likely) and reports `boundPort`/`start()`'s return value back to
/// whatever UI shows the agent-facing URL.
public struct MCPServer: Sendable {
    public let registry: MCPToolRegistry
    private let httpServer: MCPHTTPServer

    public init(
        trafficSource: MCPTrafficSource,
        collectionDirectoryProvider: MCPCollectionDirectoryProvider,
        port: UInt16 = mcpDefaultPort
    ) {
        let collectionSource = MCPCollectionSource(provider: collectionDirectoryProvider)
        let registry = MCPToolRegistry(tools: [
            MCPListRequestsTool(source: trafficSource),
            MCPGetRequestTool(source: trafficSource),
            MCPListCollectionsTool(source: collectionSource),
            MCPGetCollectionRequestTool(source: collectionSource),
        ])
        self.registry = registry
        self.httpServer = MCPHTTPServer(handler: MCPRequestHandler(registry: registry), port: port)
    }

    public var isRunning: Bool {
        get async { await httpServer.isRunning }
    }

    public var boundPort: UInt16? {
        get async { await httpServer.boundPort }
    }

    /// Starts the HTTP listener and returns the bound port (useful with
    /// `port: 0`, where the OS picks one) — see the type doc comment for
    /// "reported back to the caller".
    @discardableResult
    public func start() async throws -> UInt16 {
        try await httpServer.start()
    }

    public func stop() async {
        await httpServer.stop()
    }
}
