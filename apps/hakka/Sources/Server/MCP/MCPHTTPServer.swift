import Foundation
import Network

/// Not currently used by anything else in this repo — chosen adjacent to
/// `bridgeDefaultPort` (8989) purely as a memorable default; nothing hard
/// requires this exact value; `MCPHTTPServer.init(port: 0)` picks an
/// ephemeral one instead, which is what every test here uses.
public let mcpDefaultPort: UInt16 = 8990

/// Owns the `NWListener` for the native MCP server — the HTTP transport for
/// `MCPRequestHandler`'s JSON-RPC surface.
///
/// HTTP-over-POST, not stdio: the reference MCP transport is a server
/// spawned as a *child process* talking JSON-RPC over stdin/stdout, which is
/// how `hakka mcp` (a Node CLI) works. A GUI app is not spawnable as a
/// stdio child of an agent's process — it launches independently, is
/// already running, and has its own stdout wired to nothing an MCP client
/// controls — so there is no stdio transport available here even in
/// principle. HTTP is the correct fit: the app opens a local port, an agent
/// on the SAME machine points its MCP client at it, and each `tools/call`
/// is one POST/response like any other local HTTP API.
///
/// Follows `BridgeServer`'s `NWListener` idiom (same actor shape, same
/// `acceptLocalOnly` mechanism) rather than adding an HTTP-server
/// dependency or inventing a different listener pattern for one more local
/// socket in this app.
public actor MCPHTTPServer {
    private let handler: MCPRequestHandler
    private let requestedPort: UInt16
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.desktop.mcp-server")
    private var listener: NWListener?

    /// `port == 0` binds an ephemeral port — what every test here uses, and
    /// what a caller who only wants "some free local port, tell me which"
    /// should pass.
    public init(handler: MCPRequestHandler, port: UInt16 = mcpDefaultPort) {
        self.handler = handler
        self.requestedPort = port
    }

    public var isRunning: Bool { listener != nil }
    public var boundPort: UInt16? { listener?.port?.rawValue }

    /// Off by default, started explicitly — this call is the only thing
    /// that ever opens the socket, and the bound port is returned so the
    /// caller (Settings UI, or a test) can report/use it without a second
    /// round trip through `boundPort`.
    @discardableResult
    public func start() async throws -> UInt16 {
        guard listener == nil else {
            guard let bound = boundPort else { throw MCPHTTPServerError.notBound }
            return bound
        }

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        // Hardcoded `true`, unlike `BridgeServerOptions.allowLAN` (which
        // defaults `false` but can opt in for on-device debugging): there is
        // no legitimate reason for this endpoint to be LAN-reachable. It is
        // a trust boundary onto this Mac's own filesystem (collections) and
        // live traffic, meant for a coding agent running on the SAME
        // machine as this app — never a network peer. This is never made
        // configurable.
        parameters.acceptLocalOnly = true

        let port: NWEndpoint.Port = requestedPort == 0 ? .any : (NWEndpoint.Port(rawValue: requestedPort) ?? .any)
        let listener = try NWListener(using: parameters, on: port)

        let handler = self.handler
        let connectionQueue = queue
        listener.newConnectionHandler = { connection in
            let peer = MCPHTTPConnection(connection: connection, handler: handler)
            peer.start(on: connectionQueue)
        }

        listener.stateUpdateHandler = { [weak self] state in
            if case .failed = state {
                Task { await self?.clearListener() }
            }
        }

        listener.start(queue: queue)
        self.listener = listener
        // `NWListener.port` reflects the *requested* port immediately —
        // for `.any` that is a non-nil `0`, not `nil` — and only updates to
        // the OS-assigned real port once the listener reaches `.ready`.
        // `BridgeSocketTests`' own `boundPort(of:)` helper hit this same
        // "non-nil zero" trap polling `BridgeServer`; the fix there (and
        // here) is polling for non-nil AND non-zero, not just non-nil.
        // Callers that pass an explicit non-zero port already know it, so
        // this loop only ever spins for the `port == 0` (ephemeral) path.
        var attempts = 0
        while attempts < 200 {
            if let bound = boundPort, bound != 0 { return bound }
            try await Task.sleep(nanoseconds: 5_000_000)
            attempts += 1
        }
        throw MCPHTTPServerError.notBound
    }

    public func stop() {
        listener?.cancel()
        listener = nil
    }

    private func clearListener() {
        listener = nil
    }
}

enum MCPHTTPServerError: Error, Equatable {
    /// The listener never resolved a bound port before `start()` gave up
    /// waiting — practically only reachable if the OS refuses the bind
    /// outright, which normally surfaces as a thrown error from
    /// `NWListener(using:on:)` itself first.
    case notBound
}
