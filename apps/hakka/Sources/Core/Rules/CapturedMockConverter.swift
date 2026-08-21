import Foundation
import HakkaCommon

/// The capture → mock promotion: freezes a captured response into a mock
/// rule the device engines serve verbatim — replay the app's own real
/// response with no proxy in the path.
public enum CapturedMockConverter {
    /// Thrown by `entry(from:)` when the capture has nothing usable to
    /// replay — the request is still pending or the network call itself
    /// failed. Without this guard, promotion would fabricate a `200 ""`
    /// mock that silently masks the original failure.
    public enum PromotionError: Error, Equatable, LocalizedError {
        case incompleteCapture(url: String, underlying: String?)

        public var errorDescription: String? {
            switch self {
            case .incompleteCapture(let url, let underlying):
                if let underlying, !underlying.isEmpty {
                    return "Can't promote \(url) to a mock: the request failed (\(underlying))"
                }
                return "Can't promote \(url) to a mock: no response was captured"
            }
        }
    }

    /// A ready-to-install entry; re-promoting the same request replaces the
    /// same wire id rather than piling up duplicates. Throws
    /// `PromotionError.incompleteCapture` for a request with no status
    /// (pending, or dropped before a response arrived) or a recorded
    /// transport error — there is no real response to freeze.
    public static func entry(from request: NetworkRequest) throws -> RuleEntry {
        guard request.status != nil, request.error == nil else {
            throw PromotionError.incompleteCapture(url: request.url, underlying: request.error)
        }
        return RuleEntry(id: ruleID(for: request), payload: .mock(mockRule(from: request)))
    }

    /// Matches the endpoint, not one query string: scheme + host + port +
    /// path, with volatile query parameters dropped. Substring semantics —
    /// the engines match this against the full request URL.
    public static func mockRule(from request: NetworkRequest) -> MockRuleInput {
        MockRuleInput(
            pattern: pattern(for: request),
            isRegex: false,
            method: request.method.rawValue,
            response: MockResponse(
                status: request.status ?? 200,
                headers: responseHeaders(from: request),
                body: request.responseBody ?? "",
                delay: 0
            ),
            enabled: true
        )
    }

    /// Deterministic id from the match key, so the second promotion of the
    /// same endpoint replaces the first. Wire-safe characters only.
    public static func ruleID(for request: NetworkRequest) -> String {
        let key = "\(request.method.rawValue) \(pattern(for: request))"
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in key.utf8 {
            hash = (hash &- UInt64(byte)) &* 0x100_0000_01b3
        }
        return "mck-\(String(hash, radix: 36))"
    }

    private static func pattern(for request: NetworkRequest) -> String {
        guard let url = URL(string: request.url),
              let scheme = url.scheme?.isEmpty == false ? url.scheme : nil,
              let host = url.host else {
            return request.url
        }
        var pattern = "\(scheme)://\(host)"
        if let port = url.port {
            pattern += ":\(port)"
        }
        return pattern + url.path
    }

    /// The captured response headers that can be replayed verbatim. Bodies
    /// are stored decoded, so `Content-Encoding` would label plaintext as
    /// compressed, and `Content-Length` describes bytes the serving stack
    /// recomputes — both dropped; everything else (Content-Type, Set-Cookie,
    /// …) survives.
    ///
    /// `MockResponse.headers` is `[String: String]` — one value per name —
    /// so a header captured with multiple values has to be folded into one.
    /// Per RFC 7230 §3.2.2 that fold is safe for ordinary headers (join with
    /// `", "`, identical in meaning to the separate fields). `Set-Cookie` is
    /// the documented exception: RFC 6265 §3 forbids combining multiple
    /// Set-Cookie values into one field, because a comma can legally appear
    /// inside a cookie's own `Expires` attribute, so a joined value would be
    /// ambiguous or outright corrupt. There is no lossless way to carry two
    /// Set-Cookie values through this wire shape, so we keep the first and
    /// drop the rest — replaying one real cookie beats replaying a mangled
    /// one that satisfies neither.
    private static func responseHeaders(from request: NetworkRequest) -> [String: String] {
        let excluded: Set<String> = ["content-encoding", "content-length", "transfer-encoding", "connection"]
        var headers: [String: String] = [:]
        for (name, values) in request.responseHeaders {
            let lower = name.lowercased()
            guard !excluded.contains(lower), !values.isEmpty else { continue }
            headers[name] = lower == "set-cookie" ? values[0] : values.joined(separator: ", ")
        }
        return headers
    }
}
