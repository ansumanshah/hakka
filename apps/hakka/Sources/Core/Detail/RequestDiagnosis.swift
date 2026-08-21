import Foundation
import HakkaCommon

/// Severity bucket for a diagnosis line, mirroring the existing status-color
/// semantics (`Fmt.statusColor`'s 2xx/3xx/4xx-5xx buckets plus the `info`
/// tone already used for informational states elsewhere in Detail). The view
/// maps this to `ThemeTokens.Status` — this type carries no `Color` because
/// `HakkaCore` has no SwiftUI dependency.
public enum DiagnosisSeverity: Sendable, Equatable {
    case error
    case warning
    case info
}

/// One deterministic, evidence-backed sentence explaining what happened on
/// this request. Never speculative: every case below cites the exact fields
/// that support it. When the evidence does not fully support a specific
/// claim, `RequestDiagnoser.diagnose` returns `nil` rather than guessing.
public struct RequestDiagnosis: Sendable, Equatable {
    public let text: String
    public let severity: DiagnosisSeverity
    public let systemImage: String

    public init(text: String, severity: DiagnosisSeverity, systemImage: String) {
        self.text = text
        self.severity = severity
        self.systemImage = systemImage
    }
}

/// Pure derivation of `RequestDiagnosis` from fields already captured on a
/// `NetworkRequest`. No network, no model call — every rule is a direct
/// readback of evidence already on the record.
public enum RequestDiagnoser {
    public static func diagnose(_ record: NetworkRequest) -> RequestDiagnosis? {
        if let error = record.error, !error.isEmpty {
            if let d = transportFailure(record) { return d }
            if let d = redirectChainError(record) { return d }
            return nil
        }
        if let status = record.status, let d = statusDiagnosis(status: status, record: record) {
            return d
        }
        return contentTypeMismatch(record)
    }

    // MARK: - Transport failures (error present, no HTTP status reached)

    /// A phase-specific transport failure reason, before any redirect
    /// context is folded in. Kept separate from `transportFailure` so a
    /// request that both redirected and died mid-handshake keeps both
    /// facts — see that function's doc comment for why this matters.
    private struct TransportPhaseReason {
        let text: String
        let systemImage: String
    }

    /// Where in the connection lifecycle a transport error happened, read
    /// off which timing phases completed before it failed. The three cases
    /// are mutually exclusive by construction: TLS is checked first because
    /// a measured handshake is the most specific stage available.
    private static func transportFailurePhase(_ record: NetworkRequest) -> TransportPhaseReason? {
        if record.tlsMs != nil {
            return TransportPhaseReason(
                text: "TLS handshake started and did not complete: the connection died during the handshake.",
                systemImage: "lock.trianglebadge.exclamationmark"
            )
        }
        if record.connectMs != nil && record.ttfbMs == nil {
            return TransportPhaseReason(
                text: "Connected to the server, then received no response before it failed.",
                systemImage: "network.slash"
            )
        }
        if record.dnsMs != nil && record.connectMs == nil {
            return TransportPhaseReason(
                text: "DNS resolved the host, then the connection itself could not be established.",
                systemImage: "network.slash"
            )
        }
        return nil
    }

    /// A transport error, phrased around whichever phase it died in. When
    /// the record also redirected, the redirect context (hop count, final
    /// URL) is folded into the same sentence rather than dropped — a
    /// request that redirected three times and then died mid-handshake on
    /// the final hop is a different bug from one that died on the first
    /// connection attempt, and losing the hop count would hide that.
    private static func transportFailure(_ record: NetworkRequest) -> RequestDiagnosis? {
        guard let phase = transportFailurePhase(record) else { return nil }
        guard record.redirectCount > 0 else {
            return RequestDiagnosis(text: phase.text, severity: .error, systemImage: phase.systemImage)
        }
        let finalUrl = record.redirectUrls.last ?? record.url
        let hops = record.redirectCount == 1 ? "1 redirect" : "\(record.redirectCount) redirects"
        return RequestDiagnosis(
            text: "\(phase.text) This followed \(hops), ending at \(finalUrl).",
            severity: .error,
            systemImage: phase.systemImage
        )
    }

    /// A redirect chain that ended in a transport error with no phase
    /// evidence to pin the failure to a stage — the fallback when
    /// `transportFailure` has nothing more specific to say.
    private static func redirectChainError(_ record: NetworkRequest) -> RequestDiagnosis? {
        guard record.redirectCount > 0 else { return nil }
        let finalUrl = record.redirectUrls.last ?? record.url
        let hops = record.redirectCount == 1 ? "1 redirect" : "\(record.redirectCount) redirects"
        return RequestDiagnosis(
            text: "Failed after \(hops), ending at \(finalUrl).",
            severity: .error,
            systemImage: "arrow.triangle.branch"
        )
    }

}
