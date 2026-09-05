// @generated — do not edit. Synced from ios/Sources/UI/Helpers/Fmt.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
import UIKit

// MARK: - Haptics

/// Centralized haptic feedback for HakkaUI actions.
@MainActor
enum Haptics {
    static func light() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    static func medium() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    static func warning() {
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

// MARK: - HeadersView

/// Displays headers as key: value lines with optional body below.
/// Tapping the body section triggers `onBodyTap` for full-screen viewing.
struct HeadersView: View {
    let headers: [String: [String]]
    let content: String?
    let bodySize: Int64
    var onBodyTap: (() -> Void)? = nil
    var searchText: String = ""

    // Shrink-to-fit key column, shared across every row in this list — the
    // column takes only as much width as its widest key actually needs.
    @State private var keyColumnWidth: CGFloat = 0

    var body: some View {
        if headers.isEmpty && content == nil {
            Text("(empty)")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        } else {
            VStack(alignment: .leading, spacing: Theme.s6) {
                ForEach(headers.keys.sorted(), id: \.self) { key in
                    if let values = headers[key] {
                        ForEach(values, id: \.self) { value in
                            ColoredKeyValueRow(
                                key: key,
                                value: value,
                                searchText: searchText,
                                valueColor: headerValueColor(for: key),
                                copyValue: "\(key): \(value)",
                                keyColumnWidth: keyColumnWidth > 0 ? keyColumnWidth : nil
                            )
                        }
                    }
                }

                if let content {
                    Divider().overlay(Theme.border)
                    bodyPreview(content)
                } else if bodySize > 0 {
                    Divider().overlay(Theme.border)
                    Text("\(Fmt.formatBytes(bodySize)) (binary)")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .onPreferenceChange(KeyColumnWidth.self) { keyColumnWidth = $0 }
        }
    }

    @ViewBuilder
    private func bodyPreview(_ content: String) -> some View {
        if onBodyTap != nil {
            Button(action: { onBodyTap?() }) {
                VStack(alignment: .leading, spacing: Theme.s4) {
                    SearchHighlightedText(
                        text: content,
                        searchText: searchText,
                        font: .caption2.monospaced(),
                        color: Theme.text,
                        lineLimit: 8
                    )
                    .multilineTextAlignment(.leading)

                    HStack(spacing: Theme.s4) {
                        Image(systemName: "magnifyingglass")
                        Text("Tap to view full body")
                    }
                    .font(.caption2)
                    .foregroundStyle(Theme.info)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            SearchHighlightedText(
                text: content,
                searchText: searchText,
                font: .caption2.monospaced(),
                color: Theme.text
            )
            .textSelection(.enabled)
            .frame(maxHeight: 300)  // ui-token-check-ignore: multi-line editor bounds — content box, not a control
        }
    }

    private func headerValueColor(for key: String) -> Color {
        let lower = key.lowercased()
        if lower.contains("cookie") { return Theme.warning }
        if lower.contains("authorization") || lower.contains("token") || lower.contains("key") {
            return Theme.error
        }
        if lower.contains("content-type") || lower.contains("accept") {
            return Theme.methodPut
        }
        if lower.contains("cache") || lower.contains("etag") {
            return Theme.success
        }
        return Theme.text
    }
}

// MARK: - Fmt

/// Shared formatting helpers for HakkaUI views.
enum Fmt {

    static func formatDuration(_ ms: Int64) -> String {
        ms >= 1000 ? String(format: "%.1fs", Double(ms) / 1000.0) : "\(ms)ms"
    }

    static func formatBytes(_ bytes: Int64) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", Double(bytes) / 1024.0) }
        return String(format: "%.1f MB", Double(bytes) / (1024.0 * 1024.0))
    }

    static func prettyPrintedJSON(_ string: String) -> String? {
        guard let data = string.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
        else { return nil }
        return String(data: pretty, encoding: .utf8)
    }

    static func statusColor(for code: Int?) -> Color {
        Theme.statusColor(for: code)
    }

    static func reasonPhrase(for code: Int) -> String? {
        switch code {
        case 200: return "OK"
        case 201: return "Created"
        case 204: return "No Content"
        case 301: return "Moved"
        case 304: return "Not Modified"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 429: return "Too Many Requests"
        case 500: return "Server Error"
        case 502: return "Bad Gateway"
        case 503: return "Unavailable"
        default: return nil
        }
    }
}
// MARK: - Image Response Detection

/// Detects whether a response is an image based on Content-Type header.
enum ImageDetection {

    /// Returns the image content type (e.g. "image/png") if the response is an image, nil otherwise.
    static func imageContentType(from headers: [String: [String]]) -> String? {
        for (key, values) in headers {
            if key.lowercased() == "content-type" {
                for value in values {
                    if value.lowercased().hasPrefix("image/") {
                        return value
                    }
                }
            }
        }
        return nil
    }

    /// Attempts to decode the response body as a base64-encoded image.
    static func decodeImage(from body: String?) -> UIImage? {
        guard let body, !body.isEmpty else { return nil }
        // Strip potential data URL prefix (data:image/png;base64,...)
        let base64String: String
        if body.contains(","), body.hasPrefix("data:") {
            base64String = String(body.split(separator: ",", maxSplits: 1).last ?? "")
        } else {
            base64String = body
        }
        guard let data = Data(base64Encoded: base64String, options: .ignoreUnknownCharacters) else {
            return nil
        }
        return UIImage(data: data)
    }
}
#endif // canImport(UIKit)
