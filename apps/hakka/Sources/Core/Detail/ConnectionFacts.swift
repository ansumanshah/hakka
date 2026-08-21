/// Pure derivation of the connection story `URLSessionTaskMetrics` already
/// hands the SDK: negotiated network protocol, TLS version, and cipher
/// suite. All three are optional and frequently absent (plain HTTP has no
/// TLS facts at all), so this exists only when at least one is present —
/// callers render nothing rather than a section full of blank rows.
public struct ConnectionFacts: Sendable, Equatable {
    /// e.g. "h2", "http/1.1".
    public let networkProtocol: String?
    /// e.g. "TLSv1.3".
    public let tlsVersion: String?
    /// e.g. "AES_128_GCM_SHA256".
    public let cipherSuite: String?

    public init?(networkProtocol: String?, tlsVersion: String?, cipherSuite: String?) {
        guard networkProtocol != nil || tlsVersion != nil || cipherSuite != nil else { return nil }
        self.networkProtocol = networkProtocol
        self.tlsVersion = tlsVersion
        self.cipherSuite = cipherSuite
    }
}
