import Foundation

/// Sends one already-built `URLRequest` and reports what happened, including
/// the redirect chain. Protocol-based so tests inject a stub that never
/// touches the network; `URLSessionTransport` is the real implementation.
public protocol RequestTransport: Sendable {
    func execute(_ request: URLRequest, followRedirects: Bool) async throws -> TransportResponse
}

public struct TransportResponse: Sendable {
    public let data: Data
    public let response: HTTPURLResponse
    /// URLs the request was redirected to, in the order followed. Empty when
    /// there were no redirects, or when `followRedirects` was `false` and the
    /// first redirect response was returned as the final one.
    public let redirectChain: [URL]
    /// The send's per-phase timing, aggregated across redirect hops. Nil when
    /// the transport measured none — records then carry duration only.
    public let phases: TransportPhases?

    public init(data: Data, response: HTTPURLResponse, redirectChain: [URL] = [], phases: TransportPhases? = nil) {
        self.data = data
        self.response = response
        self.redirectChain = redirectChain
        self.phases = phases
    }
}
