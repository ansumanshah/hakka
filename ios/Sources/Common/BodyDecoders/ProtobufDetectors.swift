import Foundation

// MARK: - Registry decoders

private let protobufWireContentTypes: Set<String> = ["application/x-protobuf", "application/protobuf"]

/// Registry decoder for standalone protobuf bodies (not gRPC-wrapped) —
/// performs the full best-effort wire-format walk and returns a readable
/// field tree. Port of `decoders.ts`'s `protobufWireDecoder`.
struct ProtobufWireBodyDecoder: HakkaBodyDecoder {
    let id = "protobuf-wire"

    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String? {
        guard let ct = hakkaNormalizedMimeType(contentType), protobufWireContentTypes.contains(ct) else { return nil }
        guard let bytes = hakkaBase64Decode(body), !bytes.isEmpty else { return nil }
        let fields = decodeProtobuf(bytes)
        guard !fields.isEmpty else { return nil }
        return formatProtoFields(fields)
    }
}

private let legacyProtobufContentTypes: Set<String> = [
    "application/x-protobuf",
    "application/protobuf",
    "application/vnd.google.protobuf",
    "application/grpc",
    "application/grpc+proto",
]

/// Legacy protobuf/gRPC detector: does not attempt schema-less decoding —
/// marks the body as protobuf and returns a byte-length + hex/base64 preview.
/// Only reached in practice for `application/grpc`/`application/grpc+proto`
/// (unary gRPC), since `application/x-protobuf`/`application/protobuf` are
/// claimed first by `protobuf-wire`. Port of `decoders.ts`'s `protobufDetector`.
struct LegacyProtobufBodyDecoder: HakkaBodyDecoder {
    let id = "protobuf"

    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String? {
        guard contentType != nil else { return nil }
        let ct = hakkaNormalizedMimeType(contentType) ?? ""
        guard legacyProtobufContentTypes.contains(ct) else { return nil }

        let bytes = hakkaBase64Decode(body)
        let byteLength = bytes?.count ?? body.count

        var lines = ["[protobuf — \(byteLength) bytes]"]
        if let bytes, !bytes.isEmpty {
            let previewBytes = bytes.prefix(32)
            var hexPreview = previewBytes.map { String(format: "%02x", $0) }.joined(separator: " ")
            if bytes.count > 32 { hexPreview += " …" }
            lines.append("hex: \(hexPreview)")
        }
        let b64Preview = body.count > 64 ? String(body.prefix(64)) + "…" : body
        lines.append("base64: \(b64Preview)")

        return lines.joined(separator: "\n")
    }
}
