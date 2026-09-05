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

/// Owns the native MCP server's on/off lifecycle for the Settings toggle
/// (`MCPSettingsSection`). Off by default and never started automatically —
/// `HakkaApp.swift`'s startup `.task` starts `traffic`/`rules`/`logs`/
/// `storage` unconditionally because live capture is this app's whole
/// point, but the MCP server opens a local port that gives an AI agent read
/// access to captured traffic and every open collection, so it only ever
/// starts from an explicit toggle a person flips.
///
/// The traffic side of `MCPTrafficSource` needs no adapter of its own —
/// `TrafficStore` already conforms via the extension in `HakkaServer`'s
/// `MCPTrafficSource.swift`, so `init(trafficStore:collectionModel:port:)`
/// passes it straight through. The collection side genuinely needs one:
/// `CollectionModel` is `@MainActor` UI state with a single `directoryURL?`,
/// not the multi-directory shape `MCPCollectionDirectoryProvider` expects —
/// see `MCPCollectionDirectoryAdapter`.
@MainActor
@Observable
final class MCPServerModel {
    private(set) var isRunning = false
    private(set) var boundPort: UInt16?
    /// Set on a failed `start()`, cleared on the next successful one. Never
    /// silently swallowed — a bind failure (another process already holding
    /// the port, a sandbox denial) has to surface here rather than leaving
    /// the Settings toggle looking stuck mid-flip with no explanation.
    private(set) var startupError: String?

    private let server: MCPServerControlling

    /// Real construction: builds the collection adapter from live app state
    /// and hands both sources to a real `MCPServer`. Defaults to
    /// `mcpDefaultPort` rather than an ephemeral `0` — unlike the test
    /// suite's own throwaway servers, the Settings pane wants a fixed,
    /// memorable port so a URL an agent saved once keeps working the next
    /// time the toggle is flipped on.
    convenience init(trafficStore: TrafficStore, collectionModel: CollectionModel, port: UInt16 = mcpDefaultPort) {
        self.init(server: MCPServer(
            trafficSource: trafficStore,
            collectionDirectoryProvider: MCPCollectionDirectoryAdapter(collectionModel: collectionModel),
            port: port,
        ))
    }

    /// Test/fake seam — see `MCPServerControlling`'s doc comment.
    init(server: MCPServerControlling) {
        self.server = server
    }

    func start() async {
        guard !isRunning else { return }
        do {
            boundPort = try await server.start()
            isRunning = true
            startupError = nil
        } catch {
            isRunning = false
            boundPort = nil
            startupError = "MCP server failed to start: \(error.localizedDescription)"
        }
    }

    func stop() async {
        await server.stop()
        isRunning = false
        boundPort = nil
    }
}
