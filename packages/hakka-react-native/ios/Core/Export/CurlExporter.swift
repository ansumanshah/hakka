// @generated — do not edit. Synced from ios/Sources/Common/Export/CurlExporter.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Generates cURL command strings from captured network requests.
public enum CurlExporter {
    /// Generate a cURL command for the given request.
    public static func export(_ request: NetworkRequest) -> String {
        var parts = ["curl"]

        if request.method != .get {
            parts.append("-X \(request.method.rawValue)")
        }

        for (key, values) in request.requestHeaders.sorted(by: { $0.key < $1.key }) {
            for value in values {
                let escapedKey = key.replacingOccurrences(of: "'", with: "'\\''")
                let escaped = value.replacingOccurrences(of: "'", with: "'\\''")
                parts.append("-H '\(escapedKey): \(escaped)'")
            }
        }

        if let body = request.requestBody {
            let escaped = body.replacingOccurrences(of: "'", with: "'\\''")
            parts.append("-d '\(escaped)'")
        }

        let urlEscaped = request.url.replacingOccurrences(of: "'", with: "'\\''")
        parts.append("'\(urlEscaped)'")

        return parts.joined(separator: " \\\n  ")
    }
}
