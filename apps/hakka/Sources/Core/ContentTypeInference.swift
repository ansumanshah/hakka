import Foundation
import UniformTypeIdentifiers

/// Guesses a `Content-Type` from a file's extension when a binary body is
/// picked — a starting point the editor's content-type field always leaves
/// overridable, since the extension is only ever a hint (a `.json` file
/// could legitimately be uploaded as `application/octet-stream`).
public enum ContentTypeInference {
    public static func contentType(forPath path: String) -> String {
        let ext = (path as NSString).pathExtension
        guard !ext.isEmpty, let type = UTType(filenameExtension: ext) else {
            return "application/octet-stream"
        }
        return type.preferredMIMEType ?? "application/octet-stream"
    }
}
