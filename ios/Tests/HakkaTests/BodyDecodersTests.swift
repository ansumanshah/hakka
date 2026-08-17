import Compression
import Foundation
import Testing
@testable import HakkaCommon

// ---------------------------------------------------------------------------
// Test-only compression helpers — produce gzip/zlib-wrapped base64 fixtures
// without a JS-style compression library. `InflateSupport`'s gunzip/inflate
// only strip framing bytes and never validate CRC/Adler checksums, so the
// trailer bytes below don't need to be correct — only the raw DEFLATE payload
// (produced by Apple's own Compression framework, the same one the decoders
// under test use) needs to round-trip.
// ---------------------------------------------------------------------------

private func compressRawDeflate(_ input: [UInt8]) -> [UInt8] {
    guard !input.isEmpty else { return [] }
    let dstCapacity = input.count + 256
    var dst = [UInt8](repeating: 0, count: dstCapacity)
    let written = dst.withUnsafeMutableBufferPointer { dstPtr in
        input.withUnsafeBufferPointer { srcPtr in
            compression_encode_buffer(dstPtr.baseAddress!, dstCapacity, srcPtr.baseAddress!, input.count, nil, COMPRESSION_ZLIB)
        }
    }
    return Array(dst.prefix(written))
}

private func gzipBase64(_ text: String) -> String {
    let deflated = compressRawDeflate(Array(text.utf8))
    var bytes: [UInt8] = [0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff] // minimal gzip header, no FEXTRA/FNAME/FCOMMENT/FHCRC
    bytes.append(contentsOf: deflated)
    bytes.append(contentsOf: [0, 0, 0, 0, 0, 0, 0, 0]) // dummy CRC32+ISIZE trailer (unverified)
    return Data(bytes).base64EncodedString()
}

private func deflateBase64(_ text: String) -> String {
    let deflated = compressRawDeflate(Array(text.utf8))
    var bytes: [UInt8] = [0x78, 0x9c] // zlib CMF/FLG header
    bytes.append(contentsOf: deflated)
    return Data(bytes).base64EncodedString()
}

// ---------------------------------------------------------------------------
// Protobuf test fixture helpers — mirror decoders.test.ts's encodeVarint/tag/strBytes
// ---------------------------------------------------------------------------

private func encodeVarint(_ n: UInt64) -> [UInt8] {
    var v = n
    var out: [UInt8] = []
    repeat {
        var byte = UInt8(v & 0x7f)
        v >>= 7
        if v != 0 { byte |= 0x80 }
        out.append(byte)
    } while v != 0
    return out
}

private func tag(_ fieldNum: Int, _ wireType: Int) -> [UInt8] {
    encodeVarint(UInt64((fieldNum << 3) | wireType))
}

private func u32be(_ n: Int) -> [UInt8] {
    [UInt8((n >> 24) & 0xff), UInt8((n >> 16) & 0xff), UInt8((n >> 8) & 0xff), UInt8(n & 0xff)]
}

private func grpcWebFrame(_ payload: [UInt8], trailer: Bool = false, compressed: Bool = false) -> [UInt8] {
    var flag: UInt8 = 0
    if trailer { flag |= 0x80 }
    if compressed { flag |= 0x01 }
    return [flag] + u32be(payload.count) + payload
}

// ---------------------------------------------------------------------------
// BodyDecoderRegistry mechanics
// ---------------------------------------------------------------------------

private struct ClosureBodyDecoder: HakkaBodyDecoder {
    let id: String
    let handler: (String, String?, String?) -> String?
    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String? {
        handler(body, contentType, contentEncoding)
    }
}

@Suite("BodyDecoderRegistry")
struct BodyDecoderRegistryTests {
    @Test func passthroughWhenEmpty() {
        let reg = BodyDecoderRegistry()
        #expect(reg.decode("raw body", contentType: nil) == "raw body")
    }

    @Test func passthroughForUnknownContentType() {
        let reg = BodyDecoderRegistry()
        #expect(reg.decode("{\"a\":1}", contentType: "application/octet-stream") == "{\"a\":1}")
    }

    @Test func firstNonNilWins() {
        let reg = BodyDecoderRegistry()
        reg.register(ClosureBodyDecoder(id: "upper") { body, _, _ in body.uppercased() })
        reg.register(ClosureBodyDecoder(id: "lower") { body, _, _ in body.lowercased() })
        #expect(reg.decode("Hello", contentType: nil) == "HELLO")
    }

    @Test func nilDefersToNextDecoder() {
        let reg = BodyDecoderRegistry()
        reg.register(ClosureBodyDecoder(id: "skip") { _, contentType, _ in contentType == "text/plain" ? nil : "MATCHED" })
        reg.register(ClosureBodyDecoder(id: "fallback") { body, _, _ in "fallback:\(body)" })
        #expect(reg.decode("hello", contentType: "text/plain") == "fallback:hello")
        #expect(reg.decode("hello", contentType: "application/json") == "MATCHED")
    }

    @Test func duplicateIdReplaces() {
        let reg = BodyDecoderRegistry()
        reg.register(ClosureBodyDecoder(id: "my-decoder") { _, _, _ in "v1" })
        #expect(reg.decode("x", contentType: nil) == "v1")
        reg.register(ClosureBodyDecoder(id: "my-decoder") { _, _, _ in "v2" })
        #expect(reg.decode("x", contentType: nil) == "v2")
    }

    @Test func allNilFallsBackToPassthrough() {
        let reg = BodyDecoderRegistry()
        reg.register(ClosureBodyDecoder(id: "noop") { _, _, _ in nil })
        #expect(reg.decode("unchanged", contentType: "application/json") == "unchanged")
    }

    @Test func forwardsContentEncoding() {
        let reg = BodyDecoderRegistry()
        final class Box: @unchecked Sendable { var seen: String? }
        let box = Box()
        reg.register(ClosureBodyDecoder(id: "spy") { _, _, enc in box.seen = enc; return nil })
        _ = reg.decode("body", contentType: "text/plain", contentEncoding: "gzip")
        #expect(box.seen == "gzip")
    }
}

// ---------------------------------------------------------------------------
// Built-in gzip decoder — round-trip
// ---------------------------------------------------------------------------

@Suite("Built-in gzip decoder — round-trip")
struct GzipDecoderTests {
    @Test func decompressesGzipBody() {
        let original = "{\"hello\":\"world\",\"n\":42}"
        let compressed = gzipBase64(original)
        #expect(bodyDecoders.decode(compressed, contentType: "application/json", contentEncoding: "gzip") == original)
    }

    @Test func decompressesWithXGzip() {
        let original = "plain text body"
        let compressed = gzipBase64(original)
        #expect(bodyDecoders.decode(compressed, contentType: "text/plain", contentEncoding: "x-gzip") == original)
    }

    @Test func noopWhenEncodingAbsent() {
        let original = "{\"hello\":\"world\"}"
        let compressed = gzipBase64(original)
        #expect(bodyDecoders.decode(compressed, contentType: "application/json", contentEncoding: nil) == compressed)
    }

    @Test func noopOnPlainBodyDespiteGzipHeader() {
        let plain = "{\"already\":\"decoded\"}"
        #expect(bodyDecoders.decode(plain, contentType: "application/json", contentEncoding: "gzip") == plain)
    }

    @Test func gracefulFallbackOnCorruptData() {
        let corrupt = "H4sIAAAAAAAA/corrupt+data+here=="
        #expect(bodyDecoders.decode(corrupt, contentType: "application/json", contentEncoding: "gzip") == corrupt)
    }

    @Test func decompressesLargerPayload() {
        let items = (0..<100).map { "{\"id\":\($0),\"name\":\"item-\($0)\"}" }.joined(separator: ",")
        let original = "{\"items\":[\(items)]}"
        let compressed = gzipBase64(original)
        #expect(bodyDecoders.decode(compressed, contentType: "application/json", contentEncoding: "gzip") == original)
    }
}

// ---------------------------------------------------------------------------
// Built-in deflate decoder — round-trip
// ---------------------------------------------------------------------------

@Suite("Built-in deflate decoder — round-trip")
struct DeflateDecoderTests {
    @Test func decompressesDeflateBody() {
        let original = "{\"hello\":\"world\",\"n\":42}"
        let compressed = deflateBase64(original)
        #expect(bodyDecoders.decode(compressed, contentType: "application/json", contentEncoding: "deflate") == original)
    }

    @Test func noopWhenEncodingAbsent() {
        let original = "hello world"
        let compressed = deflateBase64(original)
        #expect(bodyDecoders.decode(compressed, contentType: "text/plain", contentEncoding: nil) == compressed)
    }

    @Test func noopOnPlainBodyDespiteDeflateHeader() {
        let plain = "{\"already\":\"decoded\",\"value\":42}"
        #expect(bodyDecoders.decode(plain, contentType: "application/json", contentEncoding: "deflate") == plain)
    }

    @Test func gracefulFallbackOnCorruptData() {
        let corrupt = "eJwcorrupt+data+here=="
        #expect(bodyDecoders.decode(corrupt, contentType: "application/json", contentEncoding: "deflate") == corrupt)
    }
}

// ---------------------------------------------------------------------------
// Legacy protobuf detector (application/grpc, application/grpc+proto)
// ---------------------------------------------------------------------------

@Suite("Built-in protobuf detector")
struct LegacyProtobufDetectorTests {
    private static let protoBytes: [UInt8] = [0x0a, 0x02, 0x68, 0x69] // field 1, len-delim, "hi"
    private static var protoB64: String { Data(protoBytes).base64EncodedString() }

    @Test func detectsApplicationGrpc() {
        let result = bodyDecoders.decode(Self.protoB64, contentType: "application/grpc")
        #expect(result.contains("[protobuf"))
    }

    @Test func detectsApplicationGrpcProto() {
        let result = bodyDecoders.decode(Self.protoB64, contentType: "application/grpc+proto")
        #expect(result.contains("[protobuf"))
    }

    @Test func noopOnNonProtobufContentType() {
        let result = bodyDecoders.decode(Self.protoB64, contentType: "application/json")
        #expect(result == Self.protoB64)
    }

    @Test func noopWhenContentTypeIsNil() {
        let result = bodyDecoders.decode(Self.protoB64, contentType: nil)
        #expect(result == Self.protoB64)
    }
}

// ---------------------------------------------------------------------------
// application/x-protobuf / application/protobuf -> fully decoded (protobuf-wire)
// ---------------------------------------------------------------------------

@Suite("bodyDecoders registry — application/x-protobuf now fully decoded")
struct ProtobufWireRegistryContentTypeTests {
    private static let protoBytes: [UInt8] = [0x0a, 0x02, 0x68, 0x69]
    private static var protoB64: String { Data(protoBytes).base64EncodedString() }

    @Test func decodesXProtobufIntoFieldTree() {
        let result = bodyDecoders.decode(Self.protoB64, contentType: "application/x-protobuf")
        #expect(result.contains("1 (string): \"hi\""))
        #expect(!result.contains("[protobuf"))
    }

    @Test func decodesApplicationProtobufTheSameWay() {
        let result = bodyDecoders.decode(Self.protoB64, contentType: "application/protobuf")
        #expect(result.contains("1 (string): \"hi\""))
    }

    @Test func stripsContentTypeParameters() {
        let result = bodyDecoders.decode(Self.protoB64, contentType: "application/x-protobuf; charset=binary")
        #expect(result.contains("1 (string): \"hi\""))
    }
}

// ---------------------------------------------------------------------------
// Gate: built-in decoders must not run on normal (already-decoded) bodies
// ---------------------------------------------------------------------------

@Suite("built-in decoders — no-op on plain bodies")
struct NoopGateTests {
    @Test func plainJsonWithGzipHeaderPassesThrough() {
        let plain = "{\"data\":\"value\"}"
        #expect(bodyDecoders.decode(plain, contentType: "application/json", contentEncoding: "gzip") == plain)
    }

    @Test func plainTextWithDeflateHeaderPassesThrough() {
        let plain = "{\"already\":\"uncompressed\"}"
        #expect(bodyDecoders.decode(plain, contentType: "text/plain", contentEncoding: "deflate") == plain)
    }

    @Test func noEncodingHeaderIsAZeroOverheadPassthrough() {
        let plain = "{\"normal\":\"response\"}"
        #expect(bodyDecoders.decode(plain, contentType: "application/json", contentEncoding: nil) == plain)
    }

    @Test func unrelatedEncodingDoesNotTriggerGzip() {
        let plain = "brotli-decompressed text"
        #expect(bodyDecoders.decode(plain, contentType: "text/plain", contentEncoding: "br") == plain)
    }
}

// ---------------------------------------------------------------------------
// decodeSse — standalone parser
// ---------------------------------------------------------------------------

@Suite("decodeSse — standalone parser")
struct DecodeSseTests {
    @Test func parsesKnownStreamWithEventDataIdRetry() {
        let stream = [
            "event: update",
            "data: {\"n\":1}",
            "id: 1",
            "retry: 3000",
            "",
            "event: update",
            "data: {\"n\":2}",
            "id: 2",
            "",
            "data: no-event-field",
            "",
        ].joined(separator: "\n")

        let events = decodeSse(stream)
        #expect(events == [
            SseEvent(event: "update", data: "{\"n\":1}", id: "1", retry: 3000),
            SseEvent(event: "update", data: "{\"n\":2}", id: "2"),
            SseEvent(data: "no-event-field"),
        ])
    }

    @Test func joinsMultiLineDataWithNewline() {
        let stream = ["data: line one", "data: line two", "data: line three", ""].joined(separator: "\n")
        #expect(decodeSse(stream) == [SseEvent(data: "line one\nline two\nline three")])
    }

    @Test func ignoresCommentLines() {
        let stream = [":this is a comment", "data: hello", ":another comment", ""].joined(separator: "\n")
        #expect(decodeSse(stream) == [SseEvent(data: "hello")])
    }

    @Test func handlesCRLFLineEndings() {
        let stream = "event: ping\r\ndata: pong\r\n\r\n"
        #expect(decodeSse(stream) == [SseEvent(event: "ping", data: "pong")])
    }

    @Test func flushesTrailingRecordWithoutFinalBlankLine() {
        #expect(decodeSse("data: trailing") == [SseEvent(data: "trailing")])
    }

    @Test func stripsSingleLeadingSpaceOnly() {
        let events = decodeSse("data:  two spaces\n\n")
        #expect(events.first?.data == " two spaces")
    }

    @Test func ignoresNonNumericRetry() {
        let events = decodeSse("data: x\nretry: not-a-number\n\n")
        #expect(events.first?.retry == nil)
    }

    @Test func emptyBodyYieldsEmptyArray() {
        #expect(decodeSse("").isEmpty)
    }

    @Test func neverCrashesOnMalformedInput() {
        let events = decodeSse("garbage: nonsense\n\n\n:::")
        _ = events
    }
}

@Suite("bodyDecoders registry — sse content-type detection")
struct SseRegistryTests {
    @Test func decodesTextEventStreamIntoJsonEventList() throws {
        let stream = "event: greeting\ndata: hi\nid: 1\n\n"
        let result = bodyDecoders.decode(stream, contentType: "text/event-stream")
        let parsed = try #require(JSONSerialization.jsonObject(with: Data(result.utf8)) as? [[String: Any]])
        #expect(parsed.count == 1)
        #expect(parsed[0]["event"] as? String == "greeting")
        #expect(parsed[0]["data"] as? String == "hi")
        #expect(parsed[0]["id"] as? String == "1")
    }

    @Test func stripsContentTypeParameters() {
        let stream = "data: hi\n\n"
        let result = bodyDecoders.decode(stream, contentType: "text/event-stream; charset=utf-8")
        #expect(result.contains("\"data\""))
    }

    @Test func noopForNonSseContentTypes() {
        let body = "data: hi\n\n"
        #expect(bodyDecoders.decode(body, contentType: "text/plain") == body)
    }

    /// Pins the exact rendered text — key insertion order (data, event, id,
    /// retry), 2-space indent, un-escaped `/` — matching
    /// `JSON.stringify(events, null, 2)` byte-for-byte, not just the parsed
    /// structure. Guards against JSONEncoder's keyed-container key reordering.
    @Test func matchesJsonStringifyExactly() {
        let stream = "event: greeting\ndata: hi\nid: 1\nretry: 500\n\n"
        let result = bodyDecoders.decode(stream, contentType: "text/event-stream")
        let expected = """
        [
          {
            "data": "hi",
            "event": "greeting",
            "id": "1",
            "retry": 500
          }
        ]
        """
        #expect(result == expected)
    }

    @Test func emptyEventListRendersAsEmptyArray() {
        let result = bodyDecoders.decode("", contentType: "text/event-stream")
        #expect(result == "[]")
    }
}

// ---------------------------------------------------------------------------
// decodeProtobuf — hand-built messages
// ---------------------------------------------------------------------------

@Suite("decodeProtobuf — hand-built messages")
struct DecodeProtobufTests {
    @Test func decodesVarintField() {
        let bytes = tag(1, 0) + encodeVarint(150)
        let fields = decodeProtobuf(bytes)
        #expect(fields == [ProtoField(field: 1, wireType: .varint, value: .varint(150))])
    }

    @Test func decodesLengthDelimitedStringField() {
        let bytes = tag(2, 2) + encodeVarint(5) + Array("hello".utf8)
        let fields = decodeProtobuf(bytes)
        #expect(fields.count == 1)
        #expect(fields[0].field == 2)
        #expect(fields[0].wireType == .lengthDelimited)
        guard case .string(let s) = fields[0].value else {
            Issue.record("expected .string value")
            return
        }
        #expect(s == "hello")
    }

    @Test func decodesMultipleFieldTypesInOneMessage() {
        let fixed32Bytes: [UInt8] = [0x00, 0x00, 0x80, 0x3f] // 1.0f little-endian
        let bytes = tag(1, 0) + encodeVarint(42)
            + tag(2, 2) + encodeVarint(2) + Array("hi".utf8)
            + tag(3, 5) + fixed32Bytes
        let fields = decodeProtobuf(bytes)
        #expect(fields.count == 3)
        #expect(fields[0] == ProtoField(field: 1, wireType: .varint, value: .varint(42)))
        guard case .string(let s) = fields[1].value else {
            Issue.record("expected .string value")
            return
        }
        #expect(s == "hi")
        #expect(fields[2].wireType == .fixed32)
        guard case .fixed32(_, let float) = fields[2].value else {
            Issue.record("expected .fixed32 value")
            return
        }
        #expect(abs(float - 1.0) < 0.0001)
    }

    @Test func recursesIntoCleanSubMessage() {
        let inner = tag(1, 0) + encodeVarint(7)
        let outer = tag(5, 2) + encodeVarint(UInt64(inner.count)) + inner
        let fields = decodeProtobuf(outer)
        #expect(fields.count == 1)
        guard case .message(let nested) = fields[0].value else {
            Issue.record("expected .message value")
            return
        }
        #expect(nested == [ProtoField(field: 1, wireType: .varint, value: .varint(7))])
    }

    @Test func rendersNonUtf8BytesAsHex() {
        let raw: [UInt8] = [0xff, 0x00, 0x01, 0x02]
        let bytes = tag(9, 2) + encodeVarint(UInt64(raw.count)) + raw
        let fields = decodeProtobuf(bytes)
        #expect(fields.count == 1)
        guard case .bytes = fields[0].value else {
            Issue.record("expected .bytes value")
            return
        }
    }

    @Test func neverThrowsAndReturnsPartialTreeOnMalformedInput() {
        // Valid first field, then a truncated second field (declares length 10 but only 2 bytes follow).
        let bytes = tag(1, 0) + encodeVarint(5) + tag(2, 2) + encodeVarint(10) + [0x01, 0x02]
        let fields = decodeProtobuf(bytes)
        #expect(fields.count >= 1)
        #expect(fields[0] == ProtoField(field: 1, wireType: .varint, value: .varint(5)))
    }

    @Test func emptyInputYieldsEmptyArray() {
        #expect(decodeProtobuf([]).isEmpty)
    }

    @Test func neverCrashesOnRandomGarbage() {
        let garbage: [UInt8] = Array(repeating: 0xff, count: 12)
        _ = decodeProtobuf(garbage)
    }
}

@Suite("bodyDecoders registry — protobuf-wire decoder")
struct ProtobufWireRegistryTests {
    @Test func decodesApplicationXProtobufIntoFieldTree() {
        let bytes = tag(1, 0) + encodeVarint(42)
        let b64 = Data(bytes).base64EncodedString()
        let result = bodyDecoders.decode(b64, contentType: "application/x-protobuf")
        #expect(result.contains("1 (varint): 42"))
    }

    @Test func noopForNonProtobufContentTypes() {
        let body = "not protobuf"
        #expect(bodyDecoders.decode(body, contentType: "text/plain") == body)
    }
}

// ---------------------------------------------------------------------------
// decodeGrpcWeb — length-prefixed frames
// ---------------------------------------------------------------------------

@Suite("decodeGrpcWeb — length-prefixed frames")
struct DecodeGrpcWebTests {
    @Test func decodesSingleDataFrame() {
        let message = tag(1, 0) + encodeVarint(99)
        let b64 = Data(grpcWebFrame(message)).base64EncodedString()
        let frames = decodeGrpcWeb(b64, contentType: "application/grpc-web+proto")
        #expect(frames.count == 1)
        #expect(frames[0].isTrailer == false)
        #expect(frames[0].compressed == false)
        #expect(frames[0].message == [ProtoField(field: 1, wireType: .varint, value: .varint(99))])
    }

    @Test func decodesMultipleDataFramesFollowedByTrailer() {
        let msg1 = tag(1, 0) + encodeVarint(1)
        let msg2 = tag(1, 0) + encodeVarint(2)
        let trailerText = "grpc-status: 0\r\ngrpc-message: OK\r\n"
        let allBytes = grpcWebFrame(msg1) + grpcWebFrame(msg2) + grpcWebFrame(Array(trailerText.utf8), trailer: true)
        let b64 = Data(allBytes).base64EncodedString()

        let frames = decodeGrpcWeb(b64, contentType: "application/grpc-web+proto")
        #expect(frames.count == 3)
        #expect(frames[0].message == [ProtoField(field: 1, wireType: .varint, value: .varint(1))])
        #expect(frames[1].message == [ProtoField(field: 1, wireType: .varint, value: .varint(2))])
        #expect(frames[2].isTrailer == true)
        #expect(frames[2].trailerText == trailerText)
    }

    @Test func base64DecodesWholeBodyForGrpcWebText() {
        let message = tag(1, 0) + encodeVarint(7)
        let b64 = Data(grpcWebFrame(message)).base64EncodedString()
        let frames = decodeGrpcWeb(b64, contentType: "application/grpc-web-text")
        #expect(frames.count == 1)
        #expect(frames[0].message == [ProtoField(field: 1, wireType: .varint, value: .varint(7))])
    }

    @Test func marksCompressedFlagOnCompressedDataFrame() {
        let message = tag(1, 0) + encodeVarint(1)
        let b64 = Data(grpcWebFrame(message, compressed: true)).base64EncodedString()
        let frames = decodeGrpcWeb(b64, contentType: "application/grpc-web+proto")
        #expect(frames[0].compressed == true)
    }

    @Test func neverCrashesOnTruncatedFrameData() {
        let truncated: [UInt8] = [0x00] + u32be(100) + [0x01, 0x02]
        let b64 = Data(truncated).base64EncodedString()
        let frames = decodeGrpcWeb(b64, contentType: "application/grpc-web+proto")
        #expect(frames.count >= 1)
    }

    @Test func emptyBodyYieldsEmptyFrames() {
        #expect(decodeGrpcWeb("", contentType: "application/grpc-web+proto").isEmpty)
    }
}

@Suite("bodyDecoders registry — grpc-web decoder")
struct GrpcWebRegistryTests {
    @Test func decodesGrpcWebProtoBody() {
        let message = tag(1, 0) + encodeVarint(5)
        let b64 = Data(grpcWebFrame(message)).base64EncodedString()
        let result = bodyDecoders.decode(b64, contentType: "application/grpc-web+proto")
        #expect(result.contains("[frame 0] message"))
        #expect(result.contains("1 (varint): 5"))
    }

    @Test func decodesGrpcWebTextBody() {
        let message = tag(1, 0) + encodeVarint(3)
        let b64 = Data(grpcWebFrame(message)).base64EncodedString()
        let result = bodyDecoders.decode(b64, contentType: "application/grpc-web-text")
        #expect(result.contains("[frame 0] message"))
    }

    @Test func surfacesTrailerFrameInFormattedOutput() {
        let trailerText = "grpc-status: 0\r\n"
        let b64 = Data(grpcWebFrame(Array(trailerText.utf8), trailer: true)).base64EncodedString()
        let result = bodyDecoders.decode(b64, contentType: "application/grpc-web+proto")
        #expect(result.contains("trailer"))
        #expect(result.contains("grpc-status: 0"))
    }

    @Test func noopForNonGrpcWebContentTypes() {
        let body = "not grpc-web"
        #expect(bodyDecoders.decode(body, contentType: "application/json") == body)
    }
}
