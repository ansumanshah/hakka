import Foundation
import Network

/// Mutable state is confined to queue; close cancels the socket before queuing state cleanup.
final class MCPHTTPConnection: @unchecked Sendable {
    private let connection: NWConnection
    private let handler: MCPRequestHandler
    private var buffer = Data()
    private let queue: DispatchQueue
    private let onClose: @Sendable () -> Void
    private var isClosed = false
    private var requestTask: Task<Void, Never>?
    private let maxBodyBytes = BridgeWireLimits.maxFrameBytes

    init(connection: NWConnection, handler: MCPRequestHandler, queue: DispatchQueue, onClose: @escaping @Sendable () -> Void) {
        self.connection = connection
        self.handler = handler
        self.queue = queue
        self.onClose = onClose
    }

    func start() {
        connection.stateUpdateHandler = { [self] state in
            if case .failed = state { close() }
            if case .cancelled = state { close() }
        }
        connection.start(queue: queue)
        receiveNext()
    }

    func close() {
        connection.cancel()
        queue.async { [self] in
            guard !isClosed else { return }
            isClosed = true
            requestTask?.cancel()
            requestTask = nil
            connection.stateUpdateHandler = nil
            onClose()
        }
    }

    private func receiveNext() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { content, _, isComplete, error in
            guard !self.isClosed else { return }
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
            } catch MCPHTTPRequestParser.ParseError.forbidden {
                self.respondPlain(status: "403 Forbidden", body: "Only native loopback clients are allowed")
                return
            } catch {
                self.respondPlain(status: "400 Bad Request", body: "Invalid HTTP request framing")
                return
            }

            // Not a complete request yet: either wait for more bytes, or —
            // if the peer is done sending or the socket errored — give up.
            // A partial request with no more bytes coming can never become
            // complete.
            if error != nil || isComplete {
                self.close()
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
        requestTask = Task {
            guard !Task.isCancelled else { return }
            let result = await self.handler.handle(request.body)
            guard !Task.isCancelled else { return }
            self.queue.async {
                guard !self.isClosed else { return }
                switch result {
                case let .response(data):
                    self.respondJSON(body: data)
                case .noResponse:
                    self.respondEmpty(status: "202 Accepted")
                }
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
            completion: .contentProcessed { _ in self.close() }
        )
    }
}
