// @generated — do not edit. Synced from ios/Sources/Common/Export/TextExporter.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Exports captured network requests as human-readable plain text.
public enum TextExporter {
    /// Export a single request as human-readable text.
    public static func export(_ request: NetworkRequest) -> String {
        var lines: [String] = []

        // Summary line: METHOD /path  STATUS  DURATION
        let path = extractPath(from: request.url)
        var summary = "\(request.method.rawValue) \(path)"
        if let status = request.status {
            summary += "  \(status)"
        }
        if let duration = request.duration {
            summary += "  \(formatDuration(duration))"
        }
        lines.append(summary)

        lines.append("URL: \(request.url)")

        if !request.requestHeaders.isEmpty {
            lines.append("Request Headers:")
            appendHeaders(request.requestHeaders, to: &lines)
        }

        if !request.responseHeaders.isEmpty {
            lines.append("Response Headers:")
            appendHeaders(request.responseHeaders, to: &lines)
        }

        if let body = request.requestBody {
            lines.append("Request Body:")
            lines.append("  \(body)")
        }

        if let body = request.responseBody {
            lines.append("Response Body:")
            lines.append("  \(body)")
        }

        if let error = request.error {
            lines.append("Error: \(error)")
        }

        return lines.joined(separator: "\n")
    }

    /// Export multiple requests as human-readable text, separated by "---".
    public static func export(_ requests: [NetworkRequest]) -> String {
        requests.map { export($0) }.joined(separator: "\n---\n")
    }

    // MARK: - Private

    private static func extractPath(from urlString: String) -> String {
        guard let url = URL(string: urlString) else { return urlString }
        var path = url.path
        if path.isEmpty { path = "/" }
        if let query = url.query { path += "?\(query)" }
        return path
    }

    private static func formatDuration(_ ms: Int64) -> String {
        if ms >= 1000 {
            let seconds = Double(ms) / 1000.0
            return String(format: "%.1fs", seconds)
        }
        return "\(ms)ms"
    }

    private static func appendHeaders(_ headers: [String: [String]], to lines: inout [String]) {
        for (key, values) in headers.sorted(by: { $0.key < $1.key }) {
            for value in values {
                lines.append("  \(key): \(value)")
            }
        }
    }
}
