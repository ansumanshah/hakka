import Foundation

/// The production `RequestTransport`: a thin wrapper over `URLSession`'s
/// async `data(for:delegate:)`, with `RedirectTrackingDelegate` supplying the
/// redirect chain and honoring `followRedirects`.
///
/// Cookie handling: every session built here is *cookie-silent* — it never
/// attaches cookies from a storage, and it never stores `Set-Cookie` into the
/// jar (sending is off via `httpShouldSetCookies`, accepting via the bound
/// storage's `.never` accept policy). `RequestRunner` does both through the
/// `CookieStoring` seam, which keeps behavior identical whether the transport
/// is this class or an injected test stub, and guarantees cookies are
/// attached exactly once. For the same reason `URLSession.shared` is no
/// longer a default: it reads and writes the process-wide
/// `HTTPCookieStorage.shared` implicitly, an invisible jar the inspector
/// cannot inspect, disable, or clear.
public final class URLSessionTransport: RequestTransport, Sendable {
    private let session: URLSession

    public init(session: URLSession) {
        self.session = session
    }

    /// A cookie-silent session over a fresh private cookie storage.
    public convenience init() {
        self.init(session: URLSession(configuration: URLSessionTransport.cookieSilentConfiguration()))
    }

    /// A cookie-silent session whose configuration is bound to `cookies`'
    /// backing storage when the seam carries the real jar — the binding is
    /// inert while session-level cookie handling stays off, and is what a
    /// future per-run re-enable would plug into. A test fake has no storage
    /// to bind, which changes nothing: with the flags off the session never
    /// consults the storage either way.
    public convenience init(cookies: CookieStoring) {
        let configuration = (cookies as? CookieJar)?.makeSessionConfiguration()
            ?? URLSessionTransport.cookieSilentConfiguration()
        self.init(session: URLSession(configuration: configuration))
    }

    private static func cookieSilentConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        return configuration
    }

    public func execute(_ request: URLRequest, followRedirects: Bool) async throws -> TransportResponse {
        let delegate = RedirectTrackingDelegate(followRedirects: followRedirects)
        let (data, response) = try await session.data(for: request, delegate: delegate)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        // Metrics delivery can land after the response resolves; a miss here
        // only means the record carries duration without phases.
        return TransportResponse(
            data: data,
            response: http,
            redirectChain: await delegate.redirects(),
            phases: await delegate.collectedPhases()
        )
    }
}
