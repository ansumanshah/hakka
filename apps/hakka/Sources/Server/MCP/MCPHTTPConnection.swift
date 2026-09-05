import Foundation
import Network

/// One accepted HTTP connection: read a full request (headers + body sized
/// by `Content-Length`), hand the body to `MCPRequestHandler`, write the
/// response, close. No keep-alive — every response is `Connection: close`,
/// which keeps this parser's job to "read exactly one request" instead of
/// needing to track request boundaries across a reused socket. An MCP
/// client issuing one `tools/call` per HTTP request pays one TCP handshake
/// each time; that cost is irrelevant on loopback and buys a much smaller
/// parser.
///
/// `@unchecked Sendable` for the same reason as `BridgeConnection`: every
/// callback that touches `buffer` runs serialized on the single
/// `DispatchQueue` this connection was started on (Network.framework's own
/// threading contract), so there is no concurrent-mutation hazard the
/// compiler can see but cannot disprove either.
///
/// Every closure here captures `self` strongly, deliberately, matching
/// `BridgeConnection`'s documented rationale: `NWListener.newConnectionHandler`
/// is the only place this object is created, and it keeps no reference
/// after returning — a `[weak self]` receive closure would let this object
/// deallocate before a single byte arrived, while `NWConnection` itself (kept
/// alive by the framework for as long as it has outstanding work) would
/// still complete its handshake and then silently have nowhere to deliver
/// bytes to. `close()` is what breaks the resulting retain cycle.
final class MCPHTTPConnection: @unchecked Sendable {
    private let connection: NWConnection
    private let handler: MCPRequestHandler
    private var buffer = Data()
    /// Same cap as `BridgeWireLimits.maxFrameBytes` — no reason for this
    /// transport to accept a larger single request body than the bridge
    /// accepts for a single frame.
    private let maxBodyBytes = BridgeWireLimits.maxFrameBytes

    init(connection: NWConnection, handler: MCPRequestHandler) {
        self.connection = connection
        self.handler = handler
    }

    func start(on queue: DispatchQueue) {
        connection.start(queue: queue)
        receiveNext()
    }

    private func receiveNext() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { content, _, isComplete, error in
            if let content, !content.isEmpty {
                guard self.buffer.count + content.count <= self.maxBodyBytes else {
                    self.respondPlain(status: "413 Payload Too Large", body: "Request body too large")
                    return
                }
                self.buffer.append(content)
            }

            do {
                if let parsed = try MCPHTTPRequestParser.parse(self.buffer) {
                    self.dispatch(parsed)
                    return
                }
            } catch {
                self.respondPlain(status: "400 Bad Request", body: "Invalid HTTP request framing")
                return
            }

            // Not a complete request yet: either wait for more bytes, or —
            // if the peer is done sending or the socket errored — give up.
            // A partial request with no more bytes coming can never become
            // complete.
            if error != nil || isComplete {
                self.connection.cancel()
                return
            }
            self.receiveNext()
        }
    }

    private func dispatch(_ request: MCPHTTPRequestParser.ParsedRequest) {
        guard request.method == "POST" else {
            respondPlain(status: "405 Method Not Allowed", body: "This endpoint only accepts POST")
            return
        }
        Task {
            switch await self.handler.handle(request.body) {
            case let .response(data):
                self.respondJSON(body: data)
            case .noResponse:
                self.respondEmpty(status: "202 Accepted")
            }
        }
    }

    // MARK: - Writing responses

    private func respondJSON(body: Data) {
        var head = "HTTP/1.1 200 OK\r\n"
        head += "Content-Type: application/json\r\n"
        head += "Content-Length: \(body.count)\r\n"
        head += "Connection: close\r\n\r\n"
        send(Data(head.utf8) + body)
    }

    private func respondPlain(status: String, body: String) {
        let bodyData = Data(body.utf8)
        var head = "HTTP/1.1 \(status)\r\n"
        head += "Content-Type: text/plain\r\n"
        head += "Content-Length: \(bodyData.count)\r\n"
        head += "Connection: close\r\n\r\n"
        send(Data(head.utf8) + bodyData)
    }

    private func respondEmpty(status: String) {
        send(Data("HTTP/1.1 \(status)\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8))
    }

    private func send(_ data: Data) {
        connection.send(
            content: data, isComplete: true,
            completion: .contentProcessed { _ in self.connection.cancel() }
        )
    }
}
