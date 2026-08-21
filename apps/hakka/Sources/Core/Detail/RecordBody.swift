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
            text: decodedText(text, contentType: contentType, encoding: encoding),
            contentType: contentType,
            contentEncoding: encoding
        )
    }

    /// gRPC / gRPC-Web bodies skip the shared decoder pipeline entirely: its
    /// `grpc-web`/`protobuf`/`protobuf-wire` decoders already collapse the
    /// body into a flat human-readable preview string, which throws away the
    /// per-frame byte lengths and compression flags the desktop's own
    /// `GrpcBodyDecoder` needs to render frames structurally rather than as
    /// one opaque blob. The raw captured (base64) body passes through
    /// unchanged so the desktop viewer can decode it itself.
    ///
    /// Known gap: this also skips gzip/deflate `Content-Encoding` decoding
    /// for gRPC bodies. gRPC compresses per-message (via its own compression
    /// flag), not via HTTP `Content-Encoding`, so this is not expected to
    /// bite in practice — but it is a real, documented limitation rather
    /// than a decode HakkaCommon would otherwise have performed.
    private static func decodedText(_ text: String, contentType: String?, encoding: String?) -> String {
        if let mime = BodyViewerRegistry.normalizedMimeType(contentType), mime.hasPrefix("application/grpc") {
            return text
        }
        return bodyDecoders.decode(text, contentType: contentType, contentEncoding: encoding)
    }
}
