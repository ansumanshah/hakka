import Foundation

/// Real `WebSocketConnection`: one `URLSessionWebSocketTask` on its own
/// ephemeral session (isolated from the HTTP runner's cookies/cache, same
/// reasoning `URLSessionTransport` uses for its own session), fed by a
/// receive loop that keeps pulling frames until the task ends. Frames this
/// app *sends* are not observed here — `WebSocketCaptureSession` already
/// knows what it sent and records its own frame — this type only reports
/// what came back over the wire and how the connection's lifecycle changed.
///
/// An actor even though nearly every stored property is an immutable,
/// `Sendable` `let`: the type has no actual mutable state to isolate, but
/// `WebSocketConnection` conformance requires `Sendable`, and an actor is
/// the form the brief asks for ("must be an actor or otherwise safe under
/// Swift 6 strict concurrency").
actor URLSessionWebSocketConnection: WebSocketConnection {
    nonisolated let events: AsyncStream<WebSocketConnectionEvent>

    private nonisolated let task: URLSessionWebSocketTask
    private let session: URLSession
    private nonisolated let continuation: AsyncStream<WebSocketConnectionEvent>.Continuation
    private let receiveTask: Task<Void, Never>

    init(url: URL, protocols: [String]) {
        var box: AsyncStream<WebSocketConnectionEvent>.Continuation?
        let stream = AsyncStream<WebSocketConnectionEvent> { box = $0 }
        events = stream
        let continuation = box!
        self.continuation = continuation

        let delegate = WebSocketTaskDelegate(continuation: continuation)
        let session = URLSession(configuration: .ephemeral, delegate: delegate, delegateQueue: nil)
        self.session = session
        let task = protocols.isEmpty
            ? session.webSocketTask(with: url)
            : session.webSocketTask(with: url, protocols: protocols)
        self.task = task
        task.resume()
        receiveTask = Task.detached {
            await Self.pumpReceive(task: task, continuation: continuation)
        }
    }

    deinit {
        continuation.finish()
        receiveTask.cancel()
    }

    func send(text: String) async throws {
        try await task.send(.string(text))
    }

    nonisolated func close(code: Int) {
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        task.cancel(with: closeCode, reason: nil)
    }

    /// Pulls one message at a time for as long as the task lives. `receive`
    /// throwing means the task ended — the delegate's `didCloseWith`/
    /// `didCompleteWithError` already yielded the terminal event on this
    /// same stream, so the loop just stops rather than yielding a second one.
    private static func pumpReceive(
        task: URLSessionWebSocketTask,
        continuation: AsyncStream<WebSocketConnectionEvent>.Continuation
    ) async {
        while !Task.isCancelled {
            guard let message = try? await task.receive() else { break }
            switch message {
            case let .string(text):
                continuation.yield(.frame(.capped(direction: .received, opcode: .text, text: text, bytes: nil, timestamp: nowMs())))
            case let .data(data):
                continuation.yield(.frame(.capped(direction: .received, opcode: .binary, text: nil, bytes: data, timestamp: nowMs())))
            @unknown default:
                break
            }
        }
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
