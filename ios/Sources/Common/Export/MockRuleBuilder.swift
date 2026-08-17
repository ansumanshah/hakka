import Foundation

/// Builds a `MockRuleInput` from an already-captured `NetworkRequest` — the
/// "record, then mock" path used by the detail view's **Mock this** action.
/// Mirrors `generateMockRules` in `packages/hakka-core/src/engine/mockFromTraffic.ts`
/// so a rule created here behaves the same as one created on web/RN or via
/// `hakka mcp`'s `generate_mocks`.
///
/// Design choices (kept in sync with the TS reference — see that file for the
/// full rationale):
/// - **Pattern = URL path+query, host stripped.** A mock keyed to the full
///   origin would stop matching the moment the app points at a different
///   host (staging/prod/tunnel) — path+query is stable across environments.
/// - **Requests without a usable response are skipped.** No `status` and no
///   `responseBody` means there's nothing meaningful to replay.
/// - **Content-Type is carried over** from the captured response headers so
///   JSON/text bodies keep rendering correctly when mocked.
public enum MockRuleBuilder {

    /// Header names (case-insensitive) whose value is carried onto the mocked response.
    private static let carriedResponseHeaders = ["content-type"]

    /// True when a request has nothing worth replaying — no status AND no response body.
    public static func isUnusable(_ request: NetworkRequest) -> Bool {
        request.status == nil && (request.responseBody == nil || request.responseBody == "")
    }

    /// Derive the URL path+query (origin stripped) used as the mock pattern.
    public static func derivePattern(_ url: String) -> String {
        guard let components = URLComponents(string: url) else { return url }
        let query = components.query.map { "?\($0)" } ?? ""
        let path = components.path.isEmpty ? "/" : components.path
        return path + query
    }

    /// Build a `MockRuleInput` from a captured request, or `nil` when the
    /// request has no usable response (see ``isUnusable(_:)``).
    public static func build(from request: NetworkRequest, idPrefix: String = "ui-mock") -> MockRuleInput? {
        guard !isUnusable(request) else { return nil }

        var headers: [String: String] = [:]
        let lowerToActual = request.responseHeaders.keys.reduce(into: [String: String]()) { acc, k in
            acc[k.lowercased()] = k
        }
        for name in carriedResponseHeaders {
            if let actualKey = lowerToActual[name], let value = request.responseHeaders[actualKey]?.first {
                headers[name] = value
            }
        }

        return MockRuleInput(
            pattern: derivePattern(request.url),
            isRegex: false,
            method: request.method.rawValue,
            response: MockResponse(
                status: request.status ?? 200,
                headers: headers,
                body: request.responseBody ?? ""
            ),
            enabled: true
        )
    }
}
