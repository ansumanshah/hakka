import Foundation
import HakkaCore
import HakkaServer
import Observation

/// A lifecycle interface for the native MCP server.
protocol MCPServerControlling: Sendable {
    func start() async throws -> UInt16
    func stop() async
}

extension MCPServer: MCPServerControlling {}

/// Owns the opt-in MCP listener and reports its current connection state to Settings.
@MainActor
@Observable
final class MCPServerModel {
    private(set) var isRunning = false
    private(set) var isStarting = false
    private(set) var isStopping = false
    var isChangingState: Bool {
        isStarting || isStopping
    }

    private var lifecycleID = UUID()
    private(set) var boundPort: UInt16?
    /// The most recent startup failure, cleared when a retry begins.
    private(set) var startupError: String?

    private let server: MCPServerControlling

    /// Uses a stable loopback port so saved agent configurations keep working.
    convenience init(trafficStore: TrafficStore, collectionModel: CollectionModel, port: UInt16 = mcpDefaultPort, additionalTools: [any MCPTool] = []) {
        self.init(server: MCPServer(
            trafficSource: trafficStore,
            collectionDirectoryProvider: MCPCollectionDirectoryAdapter(collectionModel: collectionModel),
            port: port,
            additionalTools: additionalTools
        ))
    }

    /// Test/fake seam — see `MCPServerControlling`'s doc comment.
    init(server: MCPServerControlling) {
        self.server = server
    }

    func start() async {
        guard !isRunning, !isChangingState else { return }
        let id = UUID()
        lifecycleID = id
        isStarting = true
        startupError = nil
        defer {
            if lifecycleID == id {
                isStarting = false
            }
        }
        do {
            let port = try await server.start()
            guard lifecycleID == id else { return }
            boundPort = port
            isRunning = true
            startupError = nil
        } catch {
            guard lifecycleID == id else { return }
            isRunning = false
            boundPort = nil
            startupError = "MCP server failed to start: \(error.localizedDescription)"
        }
    }

    func stop() async {
        guard !isStopping else { return }
        lifecycleID = UUID()
        isStarting = false
        isStopping = true
        defer { isStopping = false }
        await server.stop()
        isRunning = false
        boundPort = nil
    }
}
