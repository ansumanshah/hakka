import Foundation

/// Whether a `RequestSpec.url` (possibly still carrying unresolved
/// `{{variable}}` placeholders) names a WebSocket endpoint. A prefix check
/// rather than `URL(string:)` because the host/path may not resolve yet —
/// the scheme alone is enough to decide which console the editor shows.
public enum WebSocketURL {
    public static func isWebSocketURL(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.hasPrefix("ws://") || trimmed.hasPrefix("wss://")
    }
}
