import Foundation

/// Production `WebSocketTransport`: opens a real `URLSessionWebSocketTask`
/// per connection via `URLSessionWebSocketConnection`. Sibling to
/// `URLSessionTransport` — the same seam, the same "thin factory, all the
/// interesting behavior lives in the connection object" shape.
public struct URLSessionWebSocketTransport: WebSocketTransport {
    public init() {}

    public func connect(url: URL, protocols: [String]) async -> any WebSocketConnection {
        URLSessionWebSocketConnection(url: url, protocols: protocols)
    }
}
