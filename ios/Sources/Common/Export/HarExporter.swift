import Foundation

/// Exports captured network requests in HAR (HTTP Archive) 1.2 format.
/// Uses `JSONSerialization` directly to avoid Codable overhead.
public enum HarExporter {
    /// Export an array of requests as a HAR JSON string.
    public static func export(_ requests: [NetworkRequest], prettyPrint: Bool = false) -> String? {
        let entries = requests.map { buildEntry($0) }

        let har: [String: Any] = [
            "log": [
                "version": "1.2",
                "creator": [
                    "name": "Hakka",
                    "version": "0.1.0",
                ],
                "entries": entries,
            ] as [String: Any],
        ]

        let options: JSONSerialization.WritingOptions = prettyPrint ? [.prettyPrinted, .sortedKeys] : [.sortedKeys]
        guard let data = try? JSONSerialization.data(withJSONObject: har, options: options) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private nonisolated(unsafe) static let iso8601Formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func buildEntry(_ req: NetworkRequest) -> [String: Any] {
        let startedDateTime = iso8601Formatter.string(from: Date(timeIntervalSince1970: Double(req.startTime) / 1000.0))

        return [
            "startedDateTime": startedDateTime,
            "time": req.duration ?? 0,
            "request": buildRequest(req),
            "response": buildResponse(req),
            "cache": [:] as [String: Any],
            "timings": buildTimings(req),
        ]
    }

    private static func buildRequest(_ req: NetworkRequest) -> [String: Any] {
        let httpVer = httpVersion(from: req.networkProtocol)
        var result: [String: Any] = [
            "method": req.method.rawValue,
            "url": req.url,
            "httpVersion": httpVer,
            "headers": buildHeaders(req.requestHeaders),
            "queryString": parseQueryString(req.url),
            "headersSize": -1,
            "bodySize": req.requestBodySize,
        ]
        if let body = req.requestBody {
            let mimeType = req.requestHeaders.firstValue("Content-Type") ?? "application/octet-stream"
            result["postData"] = ["mimeType": mimeType, "text": body] as [String: Any]
        }
        return result
    }

    private static func buildResponse(_ req: NetworkRequest) -> [String: Any] {
        let mimeType = req.responseHeaders.firstValue("Content-Type") ?? ""
        return [
            "status": req.status ?? 0,
            "statusText": "",
            "httpVersion": httpVersion(from: req.networkProtocol),
            "headers": buildHeaders(req.responseHeaders),
            "content": [
                "size": req.responseBodySize,
                "mimeType": mimeType,
                "text": req.responseBody ?? "",
            ] as [String: Any],
            "redirectURL": "",
            "headersSize": -1,
            "bodySize": req.responseBodySize,
        ]
    }

    private static func buildTimings(_ req: NetworkRequest) -> [String: Any] {
        [
            "dns": req.dnsMs ?? -1,
            "connect": req.connectMs ?? -1,
            "ssl": req.tlsMs ?? -1,
            "send": 0,
            "wait": req.ttfbMs ?? req.duration ?? 0,
            "receive": req.downloadMs ?? -1,
        ]
    }

    /// One HAR header entry per value (handles multi-value headers like Set-Cookie).
    private static func buildHeaders(_ headers: [String: [String]]) -> [[String: String]] {
        headers.sorted { $0.key < $1.key }.flatMap { name, values in
            values.map { ["name": name, "value": $0] }
        }
    }

    private static func parseQueryString(_ urlString: String) -> [[String: String]] {
        guard let comps = URLComponents(string: urlString),
              let items = comps.queryItems else { return [] }
        return items.map { ["name": $0.name, "value": $0.value ?? ""] }
    }

    private static func httpVersion(from networkProtocol: String?) -> String {
        switch networkProtocol {
        case "h2": return "h2"
        case "h3": return "h3"
        case "http/1.0": return "HTTP/1.0"
        default: return "HTTP/1.1"
        }
    }
}

