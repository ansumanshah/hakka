/// Pure derivation of a request's redirect chain from `redirectUrls` plus
/// the record's own (final) `url`. A raw count is nearly useless on its own
/// — what matters is which hosts the request actually bounced through and
/// where it landed. `nil` when the record had no redirects, so callers
/// render nothing rather than an empty chain.
public struct RedirectChain: Sendable, Equatable {
    public struct Hop: Sendable, Equatable, Identifiable {
        /// Position in the chain, starting at 0 for the first hop.
        public let index: Int
        public let url: String
        /// True for the last hop — the URL the request actually landed on.
        public let isFinal: Bool
        public var id: Int { index }
    }

    /// Every hop in order, intermediate redirects followed by the final URL.
    public let hops: [Hop]

    public init?(redirectUrls: [String], finalUrl: String) {
        guard !redirectUrls.isEmpty else { return nil }
        var built = redirectUrls.enumerated().map { index, url in
            Hop(index: index, url: url, isFinal: false)
        }
        built.append(Hop(index: built.count, url: finalUrl, isFinal: true))
        hops = built
    }
}
