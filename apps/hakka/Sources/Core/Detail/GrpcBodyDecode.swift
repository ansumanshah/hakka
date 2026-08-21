import Foundation
import HakkaCommon

/// How one decoded gRPC message frame's payload renders. `.compressedNotInflated`
/// is deliberately not a field tree: `frame.compressed` means the payload
/// bytes are still gzip-compressed, and neither this decoder nor the shared
/// `GrpcWebDecoder` inflates per-message compression — walking those bytes
/// as protobuf would produce garbage that could be mistaken for real fields.
public enum GrpcFramePayload: Sendable, Equatable {
    /// Schema-less protobuf field tree (see `ProtoField` in HakkaCommon).
    case fields([ProtoField])
    /// Raw message text for the `+json` gRPC/gRPC-Web codec.
    case json(String)
    /// Per-message compression flag was set; bytes were not inflated.
    case compressedNotInflated
}

/// One length-prefixed gRPC frame as the desktop renders it.
public struct GrpcRenderFrame: Sendable, Equatable, Identifiable {
    public let id: Int
    public let compressed: Bool
    public let byteLength: Int
    public let payload: GrpcFramePayload

    public init(id: Int, compressed: Bool, byteLength: Int, payload: GrpcFramePayload) {
        self.id = id
        self.compressed = compressed
        self.byteLength = byteLength
        self.payload = payload
    }
}

/// A decoded gRPC / gRPC-Web body: its message frames, plus whatever status
/// could actually be resolved from what was captured (never fabricated).
public struct GrpcDecodedBody: Sendable, Equatable {
    public let frames: [GrpcRenderFrame]
    public let status: GrpcStatus?
    /// True for `application/grpc-web*`, where trailers ride inside the body
    /// as a pseudo-frame. False for plain `application/grpc` (real HTTP/2),
    /// where trailers are separate HTTP/2 trailer headers this capture
    /// pipeline does not currently retain (see `NetworkRequest.swift`).
    public let isGrpcWeb: Bool

    public init(frames: [GrpcRenderFrame], status: GrpcStatus?, isGrpcWeb: Bool) {
        self.frames = frames
        self.status = status
        self.isGrpcWeb = isGrpcWeb
    }
}

/// Decodes a captured gRPC / gRPC-Web body into frames + status, reusing
/// HakkaCommon's `decodeGrpcWeb`/`decodeProtobuf` for the framing and
/// wire-format walk rather than reimplementing them.
public enum GrpcBodyDecoder {
    /// `rawBase64Text` must be the body exactly as captured (no decoder
    /// pipeline applied) — framing has to be decoded from the real bytes,
    /// not a human-formatted preview. `responseHeaders` back a fallback
    /// status lookup for HTTP/2 "Trailers-Only" responses.
    public static func decode(
        rawBase64Text: String,
        contentType: String?,
        responseHeaders: [String: [String]]
    ) -> GrpcDecodedBody {
        let normalized = BodyViewerRegistry.normalizedMimeType(contentType) ?? "application/grpc"
        let isWeb = normalized.contains("grpc-web")
        let isJsonCodec = normalized.hasSuffix("+json")

        var renderFrames: [GrpcRenderFrame] = []
        var trailerCode: (code: Int, message: String?)?

        if isJsonCodec {
            let bytes = BodyBytes.decode(from: rawBase64Text)
            for (index, raw) in splitLengthPrefixedFrames(bytes).enumerated() {
                if raw.isTrailer {
                    trailerCode = GrpcTrailerParser.parse(String(decoding: raw.payload, as: UTF8.self))
                    continue
                }
                let payload: GrpcFramePayload = raw.compressed
                    ? .compressedNotInflated
                    : .json(String(decoding: raw.payload, as: UTF8.self))
                renderFrames.append(GrpcRenderFrame(id: index, compressed: raw.compressed, byteLength: raw.payload.count, payload: payload))
            }
        } else {
            for (index, frame) in decodeGrpcWeb(rawBase64Text, contentType: normalized).enumerated() {
                if frame.isTrailer {
                    trailerCode = GrpcTrailerParser.parse(frame.trailerText ?? "")
                    continue
                }
                let payload: GrpcFramePayload = frame.compressed ? .compressedNotInflated : .fields(frame.message ?? [])
                renderFrames.append(GrpcRenderFrame(id: index, compressed: frame.compressed, byteLength: frame.length, payload: payload))
            }
        }

        let status = resolveStatus(trailerCode: trailerCode, responseHeaders: responseHeaders)
        return GrpcDecodedBody(frames: renderFrames, status: status, isGrpcWeb: isWeb)
    }

    private static func resolveStatus(trailerCode: (code: Int, message: String?)?, responseHeaders: [String: [String]]) -> GrpcStatus? {
        if let trailerCode {
            return GrpcStatus(code: trailerCode.code, message: trailerCode.message, source: .grpcWebTrailerFrame)
        }
        guard let statusHeader = headerValue("grpc-status", in: responseHeaders), let code = Int(statusHeader) else {
            return nil
        }
        return GrpcStatus(code: code, message: headerValue("grpc-message", in: responseHeaders), source: .trailersOnlyResponseHeader)
    }

    private static func headerValue(_ name: String, in headers: [String: [String]]) -> String? {
        let lower = name.lowercased()
        for (key, values) in headers where key.lowercased() == lower { return values.first }
        return nil
    }
}

/// Minimal length-prefixed frame splitter for the `+json` gRPC/gRPC-Web
/// codec, where each message is JSON text rather than protobuf bytes.
/// `decodeGrpcWeb` always walks message payloads as protobuf, so it cannot
/// be reused here — only the shared 5-byte frame header (compression flag +
/// big-endian length) is duplicated, not any protobuf decoding. Never
/// throws: a truncated final frame yields whatever partial payload bytes
/// were available and stops, matching `decodeGrpcWeb`'s own recovery.
private func splitLengthPrefixedFrames(_ bytes: [UInt8]) -> [(compressed: Bool, isTrailer: Bool, payload: [UInt8])] {
    var frames: [(compressed: Bool, isTrailer: Bool, payload: [UInt8])] = []
    var pos = 0
    while pos + 5 <= bytes.count {
        let flag = bytes[pos]
        let isTrailer = flag & 0x80 != 0
        let compressed = flag & 0x01 != 0
        let length = (Int(bytes[pos + 1]) << 24) | (Int(bytes[pos + 2]) << 16) | (Int(bytes[pos + 3]) << 8) | Int(bytes[pos + 4])
        pos += 5
        let declaredEnd = pos + max(length, 0)
        let end = min(declaredEnd, bytes.count)
        frames.append((compressed, isTrailer, Array(bytes[pos..<end])))
        let truncated = end < declaredEnd
        pos = end
        if truncated { break }
    }
    return frames
}
