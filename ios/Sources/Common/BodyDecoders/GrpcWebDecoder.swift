import Foundation

/// A single length-prefixed gRPC-web frame. Port of `decoders.ts`'s `GrpcWebFrame`.
public struct GrpcWebFrame: Equatable {
    /// True when this frame is the trailer frame (MSB of the compression byte, 0x80).
    public let isTrailer: Bool
    /// True when the frame's own payload was gzip-compressed (LSB of the compression byte).
    public let compressed: Bool
    /// Byte length of the frame's message payload, per the 4-byte big-endian length prefix.
    public let length: Int
    /// Best-effort protobuf field tree for data frames (`nil` for the trailer frame).
    public let message: [ProtoField]?
    /// Raw trailer text (only set when `isTrailer` is true).
    public let trailerText: String?
}

/// Decode a gRPC-web body into its length-prefixed frames.
///
/// Frame format: `[1 compression byte][4-byte big-endian length][message bytes]`,
/// repeated. The compression byte's high bit (0x80) marks a trailer frame;
/// gRPC-web trailers are plain HTTP-header-style text, not a protobuf message.
///
/// Never throws — returns whatever frames were successfully parsed before any
/// failure. Port of `decoders.ts`'s `decodeGrpcWeb`.
public func decodeGrpcWeb(_ body: String, contentType: String? = nil) -> [GrpcWebFrame] {
    let ct = (contentType ?? "").lowercased()
    let isText = ct.contains("grpc-web-text") || ct.contains("grpc-web+text")

    let bytes: [UInt8]
    if isText {
        guard let decoded = hakkaBase64Decode(body) else { return [] }
        bytes = decoded
    } else if let decoded = hakkaBase64Decode(body) {
        bytes = decoded
    } else {
        bytes = body.unicodeScalars.map { UInt8($0.value & 0xff) }
    }

    var frames: [GrpcWebFrame] = []
    var pos = 0
    while pos + 5 <= bytes.count {
        let compressionByte = bytes[pos]
        let isTrailer = compressionByte & 0x80 != 0
        let compressed = compressionByte & 0x01 != 0
        let length = (Int(bytes[pos + 1]) << 24) | (Int(bytes[pos + 2]) << 16) | (Int(bytes[pos + 3]) << 8) | Int(bytes[pos + 4])
        pos += 5

        if pos + length > bytes.count {
            // Truncated final frame — surface the partial payload and stop.
            let partialPayload = Array(bytes[pos...])
            if isTrailer {
                frames.append(GrpcWebFrame(isTrailer: true, compressed: compressed, length: length, message: nil, trailerText: String(decoding: partialPayload, as: UTF8.self)))
            } else {
                frames.append(GrpcWebFrame(isTrailer: false, compressed: compressed, length: length, message: decodeProtobuf(partialPayload), trailerText: nil))
            }
            break
        }

        let payload = Array(bytes[pos..<(pos + length)])
        pos += length

        if isTrailer {
            frames.append(GrpcWebFrame(isTrailer: true, compressed: compressed, length: length, message: nil, trailerText: String(decoding: payload, as: UTF8.self)))
        } else {
            frames.append(GrpcWebFrame(isTrailer: false, compressed: compressed, length: length, message: decodeProtobuf(payload), trailerText: nil))
        }
    }

    return frames
}

/// Renders frames as `[frame N] trailer (...)`/`[frame N] message (...)` lines.
/// Port of `decoders.ts`'s `formatGrpcWebFrames`.
private func formatGrpcWebFrames(_ frames: [GrpcWebFrame]) -> String {
    var lines: [String] = []
    for (i, frame) in frames.enumerated() {
        if frame.isTrailer {
            lines.append("[frame \(i)] trailer (\(frame.length) bytes):")
            lines.append(frame.trailerText ?? "")
        } else {
            let compressedSuffix = frame.compressed ? ", compressed" : ""
            lines.append("[frame \(i)] message (\(frame.length) bytes\(compressedSuffix)):")
            lines.append(formatProtoFields(frame.message ?? []))
        }
    }
    return lines.joined(separator: "\n")
}

private let grpcWebContentTypes: Set<String> = [
    "application/grpc-web",
    "application/grpc-web+proto",
    "application/grpc-web-text",
    "application/grpc-web+text",
]

/// Registry decoder for gRPC-web bodies: unframes length-prefixed messages and
/// renders each as a decoded protobuf field tree. Port of `decoders.ts`'s `grpcWebDecoder`.
struct GrpcWebBodyDecoder: HakkaBodyDecoder {
    let id = "grpc-web"

    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String? {
        guard let ct = hakkaNormalizedMimeType(contentType), grpcWebContentTypes.contains(ct) else { return nil }
        let frames = decodeGrpcWeb(body, contentType: ct)
        guard !frames.isEmpty else { return nil }
        return formatGrpcWebFrames(frames)
    }
}
