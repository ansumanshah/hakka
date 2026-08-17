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
        guard let data = body.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) else { return body }
        let redacted = redactJsonValue(json)
        guard let outData = try? JSONSerialization.data(withJSONObject: redacted),
              let result = String(data: outData, encoding: .utf8) else { return body }
        return result
    }

    private func redactJsonValue(_ value: Any) -> Any {
        if var dict = value as? [String: Any] {
            for key in dict.keys {
                if config.sensitiveBodyFields.contains(key.lowercased()) {
                    dict[key] = "\u{2588}\u{2588}"
                } else {
                    dict[key] = redactJsonValue(dict[key]!)
                }
            }
            return dict
        } else if let arr = value as? [Any] {
            return arr.map { redactJsonValue($0) }
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
