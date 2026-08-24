// @generated — do not edit. Synced from ios/Sources/Network/Redaction.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation
#if canImport(HakkaCommon)
import HakkaCommon
#endif

// MARK: - Redaction & Body Capture

extension HakkaInterceptor {

    func redactHeaders(_ headers: [String: [String]]) -> [String: [String]] {
        var result = headers
        for key in headers.keys where config.shouldRedactHeader(key) {
            result[key] = result[key]!.map { _ in "\u{2588}\u{2588}" }
        }
        return result
    }

    /// Redacts sensitive query parameter values in a URL string.
    /// Uses string-based manipulation to preserve "\u{2588}\u{2588}" without percent-encoding.
    func redactQueryItems(in urlString: String) -> String {
        guard !config.sensitiveQueryItems.isEmpty,
              let qIdx = urlString.firstIndex(of: "?") else { return urlString }
        let base = String(urlString[urlString.startIndex..<qIdx])
        let rest = String(urlString[urlString.index(after: qIdx)...])
        let fIdx = rest.firstIndex(of: "#")
        let fragment = fIdx.map { String(rest[$0...]) } ?? ""
        let queryOnly = fIdx.map { String(rest[rest.startIndex..<$0]) } ?? rest
        let newQuery = queryOnly.split(separator: "&", omittingEmptySubsequences: false).map { part -> String in
            let s = String(part)
            guard let eq = s.firstIndex(of: "=") else { return s }
            let rawName = String(s[s.startIndex..<eq])
            let decoded = rawName.removingPercentEncoding ?? rawName
            return config.sensitiveQueryItems.contains(decoded.lowercased()) ? "\(rawName)=\u{2588}\u{2588}" : s
        }.joined(separator: "&")
        return "\(base)?\(newQuery)\(fragment)"
    }

    /// Redacts sensitive JSON body field values recursively.
    func redactBodyFields(_ body: String?, contentType: String?) -> String? {
        guard let body,
              !config.sensitiveBodyFields.isEmpty,
              contentType?.lowercased().contains("json") == true else { return body }
        // Depth is checked BEFORE parsing, not after. `JSONSerialization`
        // recurses as it parses, and on the small stack of a Swift concurrency
        // task it overflows rather than throwing — measured safe at depth 400
        // and crashing at 600, versus ~800 on the main thread. A stack overflow
        // is a signal, not an error, so `try?` cannot contain it, and capture
        // runs on exactly such a task inside someone else's app.
        guard !JSONDepthGuard.exceedsDepthLimit(body, limit: Self.maxRedactionDepth) else { return body }
        guard let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) else { return body }
        let redacted = redactJsonValue(json, depth: 0)
        guard let outData = try? JSONSerialization.data(withJSONObject: redacted),
              let result = String(data: outData, encoding: .utf8) else { return body }
        return result
    }

    /// Matches core-TS's `MAX_DEPTH`. A body nested past this is left alone
    /// rather than recursed into: capture must never crash the host app, and
    /// the body arrives from the network, so its depth is not ours to trust.
    private static let maxRedactionDepth = 100

    private func redactJsonValue(_ value: Any, depth: Int) -> Any {
        if depth > Self.maxRedactionDepth { return value }
        if var dict = value as? [String: Any] {
            for key in dict.keys {
                if config.sensitiveBodyFields.contains(key.lowercased()) {
                    dict[key] = "\u{2588}\u{2588}"
                } else {
                    dict[key] = redactJsonValue(dict[key]!, depth: depth + 1)
                }
            }
            return dict
        } else if let arr = value as? [Any] {
            return arr.map { redactJsonValue($0, depth: depth + 1) }
        }
        return value
    }

    /// Capture body data as text if within size limit and content type is text-based.
    func captureBody(_ data: Data?, contentType: String?) -> (String?, Int64) {
        guard let data = data else { return (nil, 0) }
        let size = Int64(data.count)
        guard Self.isTextContentType(contentType) else { return (nil, size) }
        if data.count > config.maxBodySize { return (nil, size) }
        return (String(data: data, encoding: .utf8), size)
    }

    /// Returns true if the content type represents text that can be safely decoded as UTF-8.
    static func isTextContentType(_ contentType: String?) -> Bool {
        guard let ct = contentType?.lowercased() else { return true }
        if ct.hasPrefix("text/") { return true }
        let textAppTypes = [
            "application/json",
            "application/xml",
            "application/graphql",
            "application/x-www-form-urlencoded",
            "application/javascript",
        ]
        return textAppTypes.contains(where: { ct.hasPrefix($0) })
    }

    /// Extract GraphQL operation name from content type, body, and URL.
    /// Returns nil for non-GraphQL requests or anonymous operations.
    static func extractGraphQLOperationName(contentType: String?, body: String?, url: String) -> String? {
        guard let body, !body.isEmpty else { return nil }
        let isJsonContent = contentType?.lowercased().hasPrefix("application/json") == true
        let isGraphQLUrl = url.lowercased().contains("graphql")
        guard isJsonContent || isGraphQLUrl else { return nil }

        // Same stack-overflow hazard as redactBodyFields above: JSONSerialization
        // recurses while parsing and can SIGBUS past the depth limit rather than
        // throwing, so the guard must run before parsing, not after.
        guard !JSONDepthGuard.exceedsDepthLimit(body, limit: maxRedactionDepth) else { return nil }
        guard let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }

        if let opName = json["operationName"] as? String, !opName.isEmpty {
            return opName
        }

        if let query = json["query"] as? String {
            let pattern = #"(?:query|mutation|subscription)\s+(\w+)"#
            if let regex = try? NSRegularExpression(pattern: pattern),
               let match = regex.firstMatch(in: query, range: NSRange(query.startIndex..., in: query)),
               let nameRange = Range(match.range(at: 1), in: query) {
                return String(query[nameRange])
            }
        }

        return nil
    }
}
