import Foundation
import Network

public let mcpDefaultPort: UInt16 = 8990

/// An opt-in HTTP listener restricted to local connections.
public actor MCPHTTPServer {
    private let handler: MCPRequestHandler
    private let requestedPort: UInt16
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.desktop.mcp-server")
    private var listener: NWListener?
    private var listenerID: UUID?
    private var connections: [UUID: MCPHTTPConnection] = [:]
    public private(set) var boundPort: UInt16?
    public var isRunning: Bool { boundPort != nil }
    var activeConnectionCount: Int { connections.count }

    public init(handler: MCPRequestHandler, port: UInt16 = mcpDefaultPort) {
        self.handler = handler
        self.requestedPort = port
    }

    @discardableResult
    public func start() async throws -> UInt16 {
        if listener != nil {
            guard let boundPort else { throw MCPHTTPServerError.notBound }
            return boundPort
        }
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.acceptLocalOnly = true
        let port: NWEndpoint.Port = requestedPort == 0 ? .any : (NWEndpoint.Port(rawValue: requestedPort) ?? .any)
        let listener = try NWListener(using: parameters, on: port)
        let id = UUID()
        let (readiness, continuation) = AsyncThrowingStream<Void, any Error>.makeStream()
        listener.newConnectionHandler = { [weak self] connection in
            Task { await self?.accept(connection, for: id) }
        }
        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                continuation.yield(())
                continuation.finish()
            case let .failed(error), let .waiting(error):
                continuation.finish(throwing: error)
                Task { await self?.stop(ifCurrent: id) }
            case .cancelled:
                continuation.finish(throwing: CancellationError())
            default:
                break
            }
        }
        self.listener = listener
        listenerID = id
        listener.start(queue: queue)
        do {
            return try await withTaskCancellationHandler {
                for try await _ in readiness {
                    try Task.checkCancellation()
                    guard listenerID == id, let port = listener.port?.rawValue, port != 0 else {
                        throw MCPHTTPServerError.notBound
                    }
                    boundPort = port
                    return port
                }
                throw MCPHTTPServerError.notBound
            } onCancel: {
                listener.cancel()
            }
        } catch {
            stop(ifCurrent: id)
            throw error
        }
    }

    public func stop() {
        listener?.cancel()
        listener = nil
        listenerID = nil
        boundPort = nil
        for connection in connections.values { connection.close() }
        connections.removeAll()
    }

    private func stop(ifCurrent id: UUID) {
        if listenerID == id { stop() }
    }

    private func accept(_ connection: NWConnection, for id: UUID) {
        guard listenerID == id else {
            connection.cancel()
            return
        }
        let connectionID = UUID()
        let peer = MCPHTTPConnection(connection: connection, handler: handler, queue: queue) { [weak self] in
            Task { await self?.removeConnection(connectionID) }
        }
        connections[connectionID] = peer
        peer.start()
    }

    private func removeConnection(_ id: UUID) {
        connections.removeValue(forKey: id)
    }
}

enum MCPHTTPServerError: Error, Equatable {
    case notBound
}
