/// Pure derivation of the connection story `URLSessionTaskMetrics` already
/// hands the SDK: negotiated network protocol, TLS version, and cipher
/// suite. All three are optional and frequently absent (plain HTTP has no
/// TLS facts at all), so this exists only when at least one is present —
/// callers render nothing rather than a section full of blank rows.
///
/// No "Reused" fact: `URLSessionTaskTransactionMetrics.isReusedConnection`
/// exists on the framework type, but nothing in this SDK's capture path
/// (`TaskPhaseTimestamps`/`TransportPhases`) extracts it, and the wire
/// contract (`NetworkRequest` — mirrored from
/// `packages/hakka-core/src/model/types.ts`) has no field to carry it
/// through from a relayed capture either. Rather than invent a value from
/// the phases already on hand (a reused connection *usually* means no
/// DNS/TCP/TLS were measured, but "not measured" and "not reused" are not
/// the same claim), this is left as a capture-side gap for a follow-up that
/// touches the transaction-metrics extraction and the cross-platform wire
/// contract, not the UI layer.
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
