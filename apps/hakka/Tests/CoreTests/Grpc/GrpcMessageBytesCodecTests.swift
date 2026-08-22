import Foundation
import Testing
@testable import HakkaCore

@Suite("GrpcMessageBytesCodec")
struct GrpcMessageBytesCodecTests {
    @Test func decodesPlainHex() {
        #expect(GrpcMessageBytesCodec.decode("0a0568656c6c6f") == Data([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]))
    }

    @Test func decodesHexWithPrefixAndWhitespace() {
        #expect(GrpcMessageBytesCodec.decode("0x0a 05 68 65 6c 6c 6f") == Data([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]))
    }

    @Test func decodesUppercaseHex() {
        #expect(GrpcMessageBytesCodec.decode("0A05FF") == Data([0x0a, 0x05, 0xff]))
    }

    @Test func fallsBackToBase64WhenNotValidHex() {
        // "aGVsbG8=" base64-decodes to "hello"; it also happens to satisfy
        // hex's character set were it not for the "=" and odd interpretation
        // — this string in particular is not valid hex (odd non-hex chars),
        // so it must fall through to base64.
        #expect(GrpcMessageBytesCodec.decode("aGVsbG8=") == Data("hello".utf8))
    }

    @Test func emptyTextDecodesToEmptyData() {
        #expect(GrpcMessageBytesCodec.decode("") == Data())
        #expect(GrpcMessageBytesCodec.decode("   ") == Data())
    }

    @Test func oddLengthHexLikeTextFallsBackToBase64OrFails() {
        // "abc" is odd-length hex (invalid) and also invalid base64 (not a
        // multiple of 4 with valid padding) — must return nil, not crash or
        // silently drop a nibble.
        #expect(GrpcMessageBytesCodec.decode("abc") == nil)
    }

    @Test func roundTripsThroughEncodeHex() {
        let bytes = Data([0x00, 0xff, 0x10, 0x9a, 0x01])
        #expect(GrpcMessageBytesCodec.decode(GrpcMessageBytesCodec.encodeHex(bytes)) == bytes)
    }
}
