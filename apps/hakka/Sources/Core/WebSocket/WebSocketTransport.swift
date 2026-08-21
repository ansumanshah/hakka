import Foundation

/// Events a live connection produces, oldest first, terminated by exactly
/// one of `.closed`/`.failed`. Mirrors `RequestTransport`'s discipline (ADR
/// 0009: a new send path is a transport behind a contract, not a special
/// case bolted into the runner) — the shape here is necessarily different
/// from `RequestTransport.execute`, because a socket is a session with many
/// events, not one request with one response.
public enum WebSocketConnectionEvent: Sendable, Equatable {
    case opened(wsProtocol: String?)
    case frame(WebSocketFrame)
    case closed(code: Int, reason: String?)
    case failed(String)
}

/// One open connection: an event feed plus the two things a caller can do
/// to it. `close` is not `async throws` — the brief requires disconnect to
/// always be available, so it can't be something the caller has to handle
/// failing.
public protocol WebSocketConnection: Sendable {
    var events: AsyncStream<WebSocketConnectionEvent> { get }
    func send(text: String) async throws
    func close(code: Int)
}

/// Opens a `WebSocketConnection`. The seam a test drives with a fake, the
/// way `RequestTransport` lets `RequestRunner` tests never touch the
/// network. `connect` itself never throws: a connection failure (DNS,
/// refused, TLS) is reported as a `.failed` event on the connection it
/// returns, since that's the same channel every other lifecycle change
/// arrives on.
public protocol WebSocketTransport: Sendable {
    func connect(url: URL, protocols: [String]) async -> any WebSocketConnection
}
