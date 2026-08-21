import Foundation

/// Chooses the `BodyViewerKind` for a captured body, keyed by content type
/// with two shape sniffs the content type alone cannot answer: whether a
/// JSON-declared body actually parses (and whether its root is a container),
/// and whether an untyped body is a data-URL image. Pure — no I/O, no state.
public enum BodyViewerRegistry {
    /// MIME types whose bytes carry no readable text; they get the hex dump.
    private static let binaryMimeTypes: Set<String> = [
        "application/octet-stream",
        "application/pdf",
        "application/zip",
        "application/x-7z-compressed",
        "application/gzip",
        "application/x-protobuf",
        "application/protobuf",
        "application/vnd.google.protobuf",
        "application/grpc",
        "application/grpc+proto",
        "application/grpc-web+proto",
        "application/msgpack",
        "application/cbor",
    ]

    public static func viewerKind(
        forContentType contentType: String?,
        url: String = "",
        body: String
    ) -> BodyViewerKind {
        let mime = normalizedMimeType(contentType)

        if isImageBody(mime: mime, url: url, body: body) {
            return .image
        }
        if let mime, binaryMimeTypes.contains(mime) {
            return .hex
        }
        if let mime, mime.contains("json") {
            return jsonViewerKind(for: body, scalarAllowed: true)
        }
        // Many captures arrive with no (or a generic text) content type. A
        // body that parses as a JSON container is far more readable as JSON
        // than as a wall of text, so sniff containers for those too.
        return jsonViewerKind(for: body, scalarAllowed: false)
    }

    /// `.jsonTree` for a parseable body whose root is an object or array,
    /// `.jsonPretty` for a parseable scalar root, `.text` when the body does
    /// not parse (or is a scalar under a non-JSON content type).
    private static func jsonViewerKind(for body: String, scalarAllowed: Bool) -> BodyViewerKind {
        guard let root = parsedJSONRoot(body) else { return .text }
        let isContainer = root is [String: Any] || root is [Any]
        if isContainer { return .jsonTree }
        return scalarAllowed ? .jsonPretty : .text
    }

    /// First non-whitespace character of the body — a cheap pre-check so
    /// obviously-non-JSON bodies (HTML, prose) never reach `JSONSerialization`.
    /// `"t"`/`"f"`/`"n"` admit the bare `true`/`false`/`null` scalar roots.
    private static func isJSONLeadingCharacter(_ character: Character) -> Bool {
        character == "{" || character == "[" || character == "\"" || character.isNumber
            || character == "t" || character == "f" || character == "n"
    }

    private static func parsedJSONRoot(_ body: String) -> Any? {
        guard let first = body.first(where: { !$0.isWhitespace }), isJSONLeadingCharacter(first) else {
            return nil
        }
        guard let data = body.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    /// True when the content type declares an image, the body is an inline
    /// `data:image/` URL, or the URL names an image extension the content
    /// type leaves unclassified (captures frequently lose the header).
    private static func isImageBody(mime: String?, url: String, body: String) -> Bool {
        if let mime, mime.hasPrefix("image/") { return true }
        if body.hasPrefix("data:image/") { return true }
        guard mime == nil || mime == "text/plain" else { return false }
        return urlExtensionsOfImages.contains { url.lowercased().hasSuffix(".\($0)") }
    }

    private static let urlExtensionsOfImages: Set<String> = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg"]

    /// Strips parameters and lowercases a MIME-type-shaped header value:
    /// "application/json; charset=utf-8" -> "application/json".
    static func normalizedMimeType(_ value: String?) -> String? {
        guard let value else { return nil }
        let lower = value.lowercased()
        guard let semi = lower.firstIndex(of: ";") else {
            return lower.trimmingCharacters(in: .whitespaces)
        }
        return String(lower[lower.startIndex..<semi]).trimmingCharacters(in: .whitespaces)
    }
}
