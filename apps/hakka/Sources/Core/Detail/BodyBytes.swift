import Foundation

/// Recovers the raw bytes behind a captured body string. Bodies captured as
/// binary reach the record contract as base64 (or inline `data:` URLs); text
/// bodies decode as their UTF-8 bytes. Strict base64 validation keeps prose
/// that merely looks base64-shaped from being mangled — callers hand this
/// only to the image and hex viewers, whose content types say binary, so a
/// failed decode falling back to UTF-8 bytes is the honest presentation of a
/// lossy capture.
public enum BodyBytes {
    public static func decode(from body: String) -> [UInt8] {
        if let urlBytes = dataURLBytes(from: body) { return urlBytes }
        let compact = body.trimmingCharacters(in: .whitespacesAndNewlines)
        if let base64 = Data(base64Encoded: compact) { return [UInt8](base64) }
        return [UInt8](body.utf8)
    }

    /// Bytes behind an inline `data:[mediatype][;base64],payload` URL, or
    /// `nil` when the body is not a data URL. Non-base64 data URLs decode
    /// as percent-decoded UTF-8, per the URL scheme.
    private static func dataURLBytes(from body: String) -> [UInt8]? {
        guard body.hasPrefix("data:"), let comma = body.firstIndex(of: ",") else { return nil }
        let header = String(body[body.index(body.startIndex, offsetBy: 5)..<comma])
        let payload = String(body[body.index(after: comma)...])
        guard header.hasSuffix(";base64") else {
            let decoded = payload.removingPercentEncoding ?? payload
            return [UInt8](decoded.utf8)
        }
        return Data(base64Encoded: payload).map { [UInt8]($0) } ?? []
    }
}
