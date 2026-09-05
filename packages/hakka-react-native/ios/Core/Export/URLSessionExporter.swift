// @generated — do not edit. Synced from ios/Sources/Common/Export/URLSessionExporter.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Generates idiomatic Swift `URLSession` code from captured network requests.
///
/// Output is paste-runnable into a playground or a test's async body — the
/// natural "copy as X" target for an iOS engineer, versus cURL's shell command.
public enum URLSessionExporter {
    /// Generate async/await Swift for the given request.
    public static func export(_ request: NetworkRequest) -> String {
        var lines = ["var request = URLRequest(url: URL(string: \"\(swiftEscaped(request.url))\")!)"]

        if request.method != .get {
            lines.append("request.httpMethod = \"\(request.method.rawValue)\"")
        }

        for (key, values) in request.requestHeaders.sorted(by: { $0.key < $1.key }) {
            for value in values {
                let escapedKey = swiftEscaped(key)
                let escaped = swiftEscaped(value)
                lines.append("request.setValue(\"\(escaped)\", forHTTPHeaderField: \"\(escapedKey)\")")
            }
        }

        if let body = request.requestBody, !body.isEmpty {
            lines.append("request.httpBody = Data(\"\(swiftEscaped(body))\".utf8)")
        }

        lines.append("")
        lines.append("let (data, response) = try await URLSession.shared.data(for: request)")

        return lines.joined(separator: "\n")
    }

    // MARK: - Escaping

    /// Escapes a string for embedding in a Swift double-quoted string literal.
    /// Walks character-by-character so a literal backslash is always escaped
    /// before anything after it is considered — this is what keeps `\(` (Swift
    /// string interpolation) from being emitted live: the backslash becomes
    /// `\\` and the `(` passes through untouched, so the pasted literal reads
    /// back as a plain backslash followed by a parenthesis, never a splice.
    static func swiftEscaped(_ s: String) -> String {
        var result = ""
        result.reserveCapacity(s.count)
        for char in s {
            switch char {
            case "\\": result += "\\\\"
            case "\"": result += "\\\""
            case "\n": result += "\\n"
            case "\r": result += "\\r"
            case "\t": result += "\\t"
            default: result.append(char)
            }
        }
        return result
    }
}
