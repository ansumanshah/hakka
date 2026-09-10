import Foundation
import HakkaCommon

/// A bounded metadata explanation of one captured request. It reports
/// facts held on the record and separates follow-up checks from conclusions.
/// Header values, bodies, and query values are intentionally never included.
public struct RequestAnalysisReport: Equatable, Sendable {
    public let evidence: [String]
    public let finding: String?
    public let nextChecks: [String]

    public init(evidence: [String], finding: String?, nextChecks: [String]) {
        self.evidence = evidence
        self.finding = finding
        self.nextChecks = nextChecks
    }

    public static func make(for request: NetworkRequest) -> RequestAnalysisReport {
        var evidence = [
            "Request: \(request.method.rawValue) \(safeEndpoint(request.url))",
            request.status.map { "Response status: \($0)" } ?? "Response status: none captured",
            "Bodies, header values, and query values are omitted.",
        ]
        if let duration = request.duration {
            evidence.append("Duration: \(duration) ms")
        }
        let timing = timingEvidence(request)
        if !timing.isEmpty {
            evidence.append("Timing: \(timing.joined(separator: "; "))")
        }
        if request.redirectCount > 0 {
            evidence.append("Redirects: \(request.redirectCount) captured")
        }
        if request.requestBodySize > 0 || request.responseBodySize > 0 {
            evidence.append("Sizes: request \(bytes(request.requestBodySize)); response \(bytes(request.responseBodySize))")
        }
        if let error = request.error, !error.isEmpty {
            evidence.append("Transport error captured")
        }

        return RequestAnalysisReport(
            evidence: evidence,
            finding: finding(for: request),
            nextChecks: nextChecks(for: request)
        )
    }

    /// Plain text intended for a clipboard or ticket. The output stays small
    /// and does not embed unbounded captured fields.
    public var text: String {
        var lines = ["Hakka request analysis", "", "Captured evidence:"]
        lines.append(contentsOf: evidence.map { "- \($0)" })
        if let finding {
            lines += ["", "Deterministic finding:", "- \(finding)"]
        }
        lines += ["", "Next checks (not proven by this capture):"]
        lines.append(contentsOf: nextChecks.map { "- \($0)" })
        return lines.joined(separator: "\n")
    }

    private static func finding(for request: NetworkRequest) -> String? {
        guard let diagnosis = RequestDiagnoser.diagnose(request) else { return nil }
        if request.status == 429 {
            return "Rate limiting was diagnosed from captured response metadata."
        }
        var text = diagnosis.text
        for url in ([request.url] + request.redirectUrls).sorted(by: { $0.count > $1.count }) {
            text = text.replacingOccurrences(of: url, with: safeEndpoint(url))
        }
        return text
    }

    private static func nextChecks(for request: NetworkRequest) -> [String] {
        var checks: [String] = []
        if request.error != nil {
            checks.append("Repeat once on the same device and network; compare the failing timing phase.")
        }
        if let status = request.status {
            switch status {
            case 401, 403: checks.append("Verify credential configuration without copying credentials into a report.")
            case 429: checks.append("Review rate-limit policy and retry guidance in the response details.")
            case 500 ... 599: checks.append("Correlate this request timestamp with server logs.")
            default: break
            }
        }
        if request.redirectCount > 0 {
            checks.append("Confirm the intended final destination and redirect policy in the detail view.")
        }
        if let duration = request.duration, duration >= 1000 {
            checks.append("Compare another request to this endpoint under the same conditions.")
        }
        return checks.isEmpty ? ["Compare a nearby successful request if the behavior is unexpected."] : checks
    }

    private static func timingEvidence(_ request: NetworkRequest) -> [String] {
        [
            request.dnsMs.map { "DNS \($0) ms" },
            request.connectMs.map { "connect \($0) ms" },
            request.tlsMs.map { "TLS \($0) ms" },
            request.ttfbMs.map { "first byte \($0) ms" },
            request.downloadMs.map { "download \($0) ms" },
        ].compactMap { $0 }
    }

    private static func safeEndpoint(_ value: String) -> String {
        guard let components = URLComponents(string: value),
              let scheme = components.scheme,
              let host = components.host
        else { return "Captured URL unavailable" }
        let port = components.port.map { ":\($0)" } ?? ""
        let path = components.path.isEmpty ? "/" : components.path
        let endpoint = "\(scheme)://\(host)\(port)\(path)"
        return endpoint.count <= 240 ? endpoint : String(endpoint.prefix(239)) + "…"
    }

    private static func bytes(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: count, countStyle: .memory)
    }
}
