import Foundation

/// Capture policy is applied to complete values before bounding their display size.
public enum FlowRedactor {
    private static let sensitive = Set([
        "authorization", "proxyauthorization", "cookie", "setcookie", "token", "accesstoken",
        "refreshtoken", "password", "passwd", "secret", "apikey", "xapikey", "auth", "clientsecret",
    ])
    private static func isSensitive(_ name: String) -> Bool {
        sensitive.contains(name.lowercased().filter { $0.isLetter || $0.isNumber })
    }

    public static func redact(_ raw: ProxyFlow) -> ProxyFlow {
        var flow = raw
        flow.url = redactURL(raw.url)
        flow.method = String(raw.method.prefix(16))
        flow.requestHeaders = redactHeaders(raw.requestHeaders)
        flow.responseHeaders = raw.responseHeaders.map(redactHeaders)
        flow.requestBody = redactBody(raw.requestBody, headers: raw.requestHeaders, truncated: raw.requestBodyTruncated)
        flow.responseBody = redactBody(raw.responseBody, headers: raw.responseHeaders ?? [], truncated: raw.responseBodyTruncated)
        if raw.error != nil { flow.error = "Proxy transport failed." }
        return flow
    }

    private static func redactURL(_ raw: String) -> String {
        guard raw.utf8.count <= 8192, var url = URLComponents(string: raw) else { return "[unavailable-url]" }
        url.user = nil; url.password = nil; url.fragment = nil
        if let items = url.queryItems {
            url.queryItems = items.map {
                URLQueryItem(name: $0.name, value: isSensitive($0.name) ? "[redacted]" : $0.value)
            }
        }
        return url.string ?? "[unavailable-url]"
    }

    private static func redactHeaders(_ headers: [ProxyHeader]) -> [ProxyHeader] {
        headers.prefix(128).map { header in
            ProxyHeader(name: String(header.name.prefix(128)),
                        value: isSensitive(header.name) ? "[redacted]" : String(header.value.prefix(4096)))
        }
    }

    private static func redactBody(_ body: String?, headers: [ProxyHeader], truncated: Bool) -> String? {
        guard !truncated, let body, body.utf8.count <= 1_048_576 else { return nil }
        let type = headers.first { $0.name.lowercased() == "content-type" }?.value.lowercased() ?? ""
        if type.contains("json") {
            guard !exceedsJSONDepth(body), let data = body.data(using: .utf8),
                  let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]),
                  let redacted = try? JSONSerialization.data(withJSONObject: redactJSON(value), options: [.fragmentsAllowed, .sortedKeys])
            else { return nil }
            return String(data: redacted, encoding: .utf8)
        }
        // Form, binary and unknown bodies are omitted rather than exposing values without a parser.
        guard type.hasPrefix("text/plain") else { return nil }
        let pattern = #"(?i)(authorization|cookie|token|password|secret|api[_-]?key)\s*[:=]\s*[^\r\n,;]+|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+"#
        return body.replacingOccurrences(of: pattern, with: "[redacted]", options: .regularExpression)
    }

    private static func redactJSON(_ value: Any) -> Any {
        if let dictionary = value as? [String: Any] {
            return dictionary.reduce(into: [String: Any]()) { output, entry in
                output[entry.key] = isSensitive(entry.key) ? "[redacted]" : redactJSON(entry.value)
            }
        }
        if let values = value as? [Any] { return values.map(redactJSON) }
        return value
    }

    private static func exceedsJSONDepth(_ text: String) -> Bool {
        var depth = 0, quoted = false, escaped = false
        for byte in text.utf8 {
            if quoted {
                if escaped { escaped = false }
                else if byte == 92 { escaped = true }
                else if byte == 34 { quoted = false }
            } else if byte == 34 { quoted = true }
            else if byte == 123 || byte == 91 { depth += 1; if depth > 64 { return true } }
            else if byte == 125 || byte == 93 { depth -= 1 }
        }
        return false
    }
}
