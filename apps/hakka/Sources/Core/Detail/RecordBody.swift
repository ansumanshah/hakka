import Foundation
import HakkaCommon

/// One side of a record's body, decoded and ready to display: the raw
/// captured string run through HakkaCommon's shared decoder pipeline
/// (gzip/deflate and friends), alongside the header values that chose the
/// viewer. Decoding happens once per selection, not per render.
public struct RecordBody: Sendable, Equatable {
    /// The decoded body text. Binary bodies that no decoder understood stay
    /// as their captured (base64 or lossy) string; the hex viewer re-decodes.
    public let text: String
    /// Response/request `Content-Type` as captured, parameters included.
    public let contentType: String?
    /// Response/request `Content-Encoding` as captured.
    public let contentEncoding: String?

    public init(text: String, contentType: String?, contentEncoding: String?) {
        self.text = text
        self.contentType = contentType
        self.contentEncoding = contentEncoding
    }
}

/// Extracts the displayable body for each side of a `NetworkRequest`,
/// consulting the shared `HakkaCommon` decoder registry so compressed
/// bodies render decoded on desktop exactly as they do on the other
/// platforms.
public enum RecordBodyExtractor {
    public static func responseBody(from record: NetworkRequest) -> RecordBody? {
        makeBody(record.responseBody, contentType: record.contentType, encoding: record.contentEncoding)
    }

    public static func requestBody(from record: NetworkRequest) -> RecordBody? {
        makeBody(record.requestBody, contentType: record.requestContentType, encoding: record.requestContentEncoding)
    }

    private static func makeBody(_ text: String?, contentType: String?, encoding: String?) -> RecordBody? {
        guard let text, !text.isEmpty else { return nil }
        return RecordBody(
            text: bodyDecoders.decode(text, contentType: contentType, contentEncoding: encoding),
            contentType: contentType,
            contentEncoding: encoding
        )
    }
}
