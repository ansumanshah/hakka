import Foundation

/// The production `RequestTransport`: a thin wrapper over `URLSession`'s
/// async `data(for:delegate:)`, with `RedirectTrackingDelegate` supplying the
/// redirect chain and honoring `followRedirects`.
public final class URLSessionTransport: RequestTransport, Sendable {
    private let session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func execute(_ request: URLRequest, followRedirects: Bool) async throws -> TransportResponse {
        let delegate = RedirectTrackingDelegate(followRedirects: followRedirects)
        let (data, response) = try await session.data(for: request, delegate: delegate)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        return TransportResponse(data: data, response: http, redirectChain: await delegate.redirects())
    }
}
