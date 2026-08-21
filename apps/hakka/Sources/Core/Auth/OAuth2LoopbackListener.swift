import Foundation

/// A single captured redirect: the full callback URL plus a way to answer
/// the browser (so the tab doesn't hang or show a raw connection-closed
/// error) before the listener tears itself down.
public struct OAuth2CallbackRequest: Sendable {
    public let url: URL
}

/// The seam between `OAuth2FlowRunner` and the loopback socket. The real
/// implementation binds `127.0.0.1` only, accepts exactly one connection,
/// and releases the port whether it succeeds, times out, or is cancelled —
/// never leaves a listener dangling on a port the next run needs. Tests
/// inject a fake that hands back a canned URL synchronously, so PKCE/state
/// logic can be exercised without a socket ever opening.
public protocol OAuth2LoopbackListening: Sendable {
    /// Listens on `127.0.0.1:port` for exactly one HTTP request, returns its
    /// full request URL, and has already released the port by the time this
    /// returns or throws. Throws `OAuth2FlowError.callbackTimedOut` if
    /// nothing arrives within `timeout`, or `.cancelled` if the caller's
    /// task is cancelled first.
    func awaitCallback(port: Int, timeout: TimeInterval) async throws -> URL
}
