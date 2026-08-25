import Foundation

/// Thrown by `send(text:)` when there is no open connection to send on —
/// closed, still connecting, or never connected. The brief requires a send
/// on a closed socket to fail cleanly rather than hang; throwing
/// immediately, before any network round trip, is that guarantee.
public enum WebSocketSessionError: Error, Sendable, Equatable, LocalizedError {
    case notConnected

    public var errorDescription: String? {
        switch self {
        case .notConnected: "Not connected."
        }
    }
}

/// Owns one live WebSocket connection end to end: opens it through an
/// injected `WebSocketTransport` (a fake in tests, `URLSessionWebSocketTransport`
/// in production — no test in this module ever touches the network),
/// applies `WebSocketCaps`, tracks lifecycle, and republishes a full
/// snapshot on every change: an `AsyncStream` of post-mutation snapshots a
/// `@MainActor` model mirrors with a plain assignment, no actor hop per
/// frame. Unlike `RuleStore`/`PauseStore` (ADR 0013's per-subscription
/// broadcast streams), this stream stays a single stored one — one session
/// serves exactly one `WebSocketConnectionModel` for its own short
/// connect-to-close lifetime, not a scene-tied consumer that gets cancelled
/// and re-subscribed across window closes, so the stored-stream defect ADR
/// 0013 fixes doesn't apply here.
public actor WebSocketCaptureSession {
    public nonisolated let changes: AsyncStream<WebSocketCaptureSnapshot>

    private let transport: WebSocketTransport
    private nonisolated let continuation: AsyncStream<WebSocketCaptureSnapshot>.Continuation
    private var connection: (any WebSocketConnection)?
    private var pumpTask: Task<Void, Never>?
    private var state: WebSocketConnectionState = .idle
    private var frames: [WebSocketFrame] = []
    private var droppedFrameCount = 0
    private var totalFrameCount = 0

    public init(transport: WebSocketTransport = URLSessionWebSocketTransport()) {
        self.transport = transport
        var box: AsyncStream<WebSocketCaptureSnapshot>.Continuation?
        changes = AsyncStream { box = $0 }
        continuation = box!
    }

    deinit {
        continuation.finish()
    }

    /// Opens a fresh connection, discarding any previous one's frames and
    /// closing it first — one session's history is one connection's
    /// history, matching the SSE tab's per-record scoping.
    public func connect(url: URL, protocols: [String] = []) async {
        teardownPump()
        connection?.close(code: 1000)
        connection = nil
        frames = []
        droppedFrameCount = 0
        totalFrameCount = 0
        state = .connecting
        publish()

        let opened = await transport.connect(url: url, protocols: protocols)
        connection = opened
        pumpTask = Task { [weak self] in
            for await event in opened.events {
                await self?.handle(event)
            }
        }
    }

    /// Sends a text frame and records it locally — the connection's event
    /// stream reports what it *receives*, not what this side just sent, so
    /// recording the sent half of the transcript is this method's job.
    public func send(text: String) async throws {
        guard let connection, state.isOpen else {
            throw WebSocketSessionError.notConnected
        }
        try await connection.send(text: text)
        store(.capped(direction: .sent, opcode: .text, text: text, bytes: nil, timestamp: Self.nowMs()))
        publish()
    }

    /// Always available, per the brief — callable from any state, never an
    /// error the caller has to route around. Sets `.closed` itself rather
    /// than waiting for the transport to confirm: `URLSessionWebSocketTask
    /// .cancel(with:reason:)` is a forceful cancel, not the close handshake,
    /// so nothing guarantees a `didCloseWith` delegate callback follows it —
    /// a user-initiated disconnect must not leave the UI showing "open"
    /// forever. A session already `.closed`/`.failed` is left as-is so a
    /// stray extra `disconnect()` doesn't overwrite the real reason the
    /// connection ended with a locally-invented one.
    public func disconnect(code: Int = 1000) {
        connection?.close(code: code)
        teardownPump()
        connection = nil
        guard !state.isTerminal else { return }
        state = .closed(code: code)
        publish()
    }

    private func teardownPump() {
        pumpTask?.cancel()
        pumpTask = nil
    }

    private func handle(_ event: WebSocketConnectionEvent) {
        switch event {
        case let .opened(wsProtocol):
            state = .open(wsProtocol: wsProtocol)
        case let .frame(frame):
            store(frame)
        case let .closed(code, _):
            state = .closed(code: code)
            pumpTask = nil
        case let .failed(message):
            state = .failed(message)
            pumpTask = nil
        }
        publish()
    }

    /// Enforces `WebSocketCaps.perConnectionFrameCount`. Past the cap,
    /// frames are still counted (`droppedFrameCount`, surfaced to the user)
    /// but not stored. Nothing here touches `connection` or `pumpTask` — the
    /// receive loop keeps draining the socket even once capture stops, so a
    /// chatty peer past the cap can never take the connection down with it.
    private func store(_ frame: WebSocketFrame) {
        totalFrameCount += 1
        guard frames.count < WebSocketCaps.perConnectionFrameCount else {
            droppedFrameCount += 1
            return
        }
        frames.append(frame)
    }

    private func publish() {
        continuation.yield(
            WebSocketCaptureSnapshot(
                state: state,
                frames: frames,
                droppedFrameCount: droppedFrameCount,
                totalFrameCount: totalFrameCount
            )
        )
    }

    private static func nowMs() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }
}
