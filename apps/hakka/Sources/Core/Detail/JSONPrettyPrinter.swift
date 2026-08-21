import Foundation

/// Pretty-prints captured JSON bodies with sorted keys so the output is
/// deterministic — the same body always highlights to the same string, and
/// the syntax highlighter's token scan always sees the same layout.
/// Non-JSON text returns `nil`; callers fall back to the raw body.
public enum JSONPrettyPrinter {
    public static func prettyPrinted(_ text: String) -> String? {
        guard let data = text.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else { return nil }
        guard let output = try? JSONSerialization.data(
            withJSONObject: root,
            options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed]
        ) else { return nil }
        return String(decoding: output, as: UTF8.self)
    }
}
