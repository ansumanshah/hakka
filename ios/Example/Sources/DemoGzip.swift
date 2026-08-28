import Compression
import Foundation

// MARK: - DemoGzip
//
// Builds a minimal gzip-framed, base64 body for the Advanced tab's "Gzip
// Body" mock demo. Same technique `ios/Tests/HakkaTests/BodyDecodersTests.swift`
// uses to fixture-test the SDK's own `GzipBodyDecoder` (`Common/BodyDecoders/
// GzipDeflateDecoders.swift`): Apple's Compression framework produces the raw
// DEFLATE stream, wrapped in a minimal 10-byte gzip header. `GzipBodyDecoder`
// only checks the magic bytes (`0x1f 0x8b`) and strips framing -- it never
// validates the CRC32/ISIZE trailer -- so the dummy 8-byte trailer below is
// fine; it exists only so the byte layout matches a real gzip stream.
enum DemoGzip {
    static func base64Body(for text: String) -> String {
        let deflated = compressRawDeflate(Array(text.utf8))
        var bytes: [UInt8] = [0x1F, 0x8B, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xFF]
        bytes.append(contentsOf: deflated)
        bytes.append(contentsOf: [0, 0, 0, 0, 0, 0, 0, 0]) // dummy CRC32 + ISIZE, unverified by the decoder
        return Data(bytes).base64EncodedString()
    }

    private static func compressRawDeflate(_ input: [UInt8]) -> [UInt8] {
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
}
