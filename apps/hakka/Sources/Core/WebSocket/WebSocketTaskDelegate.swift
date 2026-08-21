import Foundation

/// Forwards `URLSessionWebSocketTask` lifecycle callbacks into the
/// connection's event stream. `@unchecked Sendable` for the same reason
/// `RedirectTrackingDelegate` is: an `NSObject`-derived delegate can't be an
/// actor, and the only stored state is a `Sendable` `AsyncStream`
/// continuation — every callback writes straight to it, nothing else is
/// mutated, so there is no actual data race to check for.
final class WebSocketTaskDelegate: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private let continuation: AsyncStream<WebSocketConnectionEvent>.Continuation

    init(continuation: AsyncStream<WebSocketConnectionEvent>.Continuation) {
        self.continuation = continuation
    }

    func urlSession(
        _: URLSession,
        webSocketTask _: URLSessionWebSocketTask,
        didOpenWithProtocol wsProtocol: String?
    ) {
        continuation.yield(.opened(wsProtocol: wsProtocol))
    }

    func urlSession(
        _: URLSession,
        webSocketTask _: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) }
        continuation.yield(.closed(code: closeCode.rawValue, reason: reasonText))
        continuation.finish()
    }

    /// Fires again for a connection that never reached `didOpenWithProtocol`
    /// at all — DNS failure, connection refused, TLS failure — the one
    /// terminal path `didCloseWith` never covers. A clean close already went
    /// through that method above, so this only reports something when
    /// `error` is non-nil.
    func urlSession(_: URLSession, task _: URLSessionTask, didCompleteWithError error: (any Error)?) {
        guard let error else { return }
        continuation.yield(.failed(error.localizedDescription))
        continuation.finish()
    }
}
