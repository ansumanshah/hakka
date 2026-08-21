import Foundation

/// Suggests a file extension for saving a captured body, from its content
/// type. Falls back to `.txt` (and `.bin` for the binary set) so the save
/// panel always has a usable suggestion.
public enum BodyFileSuggestion {
    private static let extensionsByMimeType: [String: String] = [
        "application/json": "json",
        "application/ld+json": "json",
        "application/hal+json": "json",
        "text/plain": "txt",
        "text/html": "html",
        "text/xml": "xml",
        "application/xml": "xml",
        "text/css": "css",
        "text/csv": "csv",
        "text/javascript": "js",
        "application/javascript": "js",
        "application/x-www-form-urlencoded": "txt",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/x-icon": "ico",
        "image/svg+xml": "svg",
        "application/pdf": "pdf",
        "application/zip": "zip",
        "application/octet-stream": "bin",
        "application/x-protobuf": "bin",
        "application/protobuf": "bin",
    ]

    public static func fileExtension(forContentType contentType: String?) -> String {
        guard let contentType, !contentType.isEmpty else { return "txt" }
        let semi = contentType.firstIndex(of: ";") ?? contentType.endIndex
        let mime = contentType[contentType.startIndex..<semi]
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
        if let known = extensionsByMimeType[mime] { return known }
        if mime.hasPrefix("image/") { return "png" }
        if mime.contains("json") { return "json" }
        if mime.hasPrefix("text/") { return "txt" }
        return "bin"
    }
}
