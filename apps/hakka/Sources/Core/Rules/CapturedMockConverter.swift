import Foundation
import HakkaCommon

/// The capture → mock promotion: freezes a captured response into a mock
/// rule the device engines serve verbatim — replay the app's own real
/// response with no proxy in the path.
public enum CapturedMockConverter {
    /// A ready-to-install entry; re-promoting the same request replaces the
    /// same wire id rather than piling up duplicates.
    public static func entry(from request: NetworkRequest) -> RuleEntry {
        RuleEntry(id: ruleID(for: request), payload: .mock(mockRule(from: request)))
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
    private static func responseHeaders(from request: NetworkRequest) -> [String: String] {
        let excluded: Set<String> = ["content-encoding", "content-length", "transfer-encoding", "connection"]
        var headers: [String: String] = [:]
        for (name, values) in request.responseHeaders {
            guard !excluded.contains(name.lowercased()), let value = values.first else { continue }
            headers[name] = value
        }
        return headers
    }
}
