// @generated — do not edit. Synced from ios/Sources/Common/BodyDecoders/InflateSupport.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Compression
import Foundation

/// Byte-level gzip (RFC 1952) and zlib-wrapped/raw DEFLATE (RFC 1950/1951)
/// decompression, built on Apple's Compression framework. `COMPRESSION_ZLIB`
/// operates on the raw DEFLATE bitstream only — no zlib/gzip framing — so gzip
/// and zlib inputs need their header/trailer bytes stripped before inflating,
/// the direct analogue of fflate's `gunzipSync`/`decompressSync` that
/// `decoders.ts` relies on.
enum InflateSupport {
    /// Strip a gzip header + trailer and inflate the raw DEFLATE payload.
    /// Returns `nil` if the header is malformed or decompression fails.
    static func gunzip(_ bytes: [UInt8]) -> [UInt8]? {
        guard let payload = stripGzipHeader(bytes) else { return nil }
        return inflateRaw(payload)
    }

    /// Strip an optional 2-byte zlib header (CMF/FLG) and inflate the raw
    /// DEFLATE payload. If the bytes don't start with the zlib CMF magic byte,
    /// treats the whole input as raw deflate — mirrors fflate's
    /// `decompressSync` auto-detection of zlib-wrapped vs. raw deflate.
    static func inflate(_ bytes: [UInt8]) -> [UInt8]? {
        guard !bytes.isEmpty else { return [] }
        if bytes[0] == 0x78, bytes.count >= 2 {
            return inflateRaw(Array(bytes.dropFirst(2)))
        }
        return inflateRaw(bytes)
    }

    // MARK: - gzip header parsing (RFC 1952)

    private static func stripGzipHeader(_ bytes: [UInt8]) -> [UInt8]? {
        guard bytes.count >= 18, bytes[0] == 0x1f, bytes[1] == 0x8b, bytes[2] == 0x08 else { return nil }
        let flg = bytes[3]
        var pos = 10

        if flg & 0x04 != 0 { // FEXTRA
            guard pos + 2 <= bytes.count else { return nil }
            let xlen = Int(bytes[pos]) | (Int(bytes[pos + 1]) << 8)
            pos += 2 + xlen
        }
        if flg & 0x08 != 0 { // FNAME
            guard pos < bytes.count, let end = bytes[pos...].firstIndex(of: 0) else { return nil }
            pos = end + 1
        }
        if flg & 0x10 != 0 { // FCOMMENT
            guard pos < bytes.count, let end = bytes[pos...].firstIndex(of: 0) else { return nil }
            pos = end + 1
        }
        if flg & 0x02 != 0 { // FHCRC
            pos += 2
        }

        guard pos < bytes.count - 8, pos >= 0 else { return nil }
        return Array(bytes[pos..<(bytes.count - 8)])
    }

    // MARK: - raw DEFLATE via the Compression framework's streaming API

    private static func inflateRaw(_ input: [UInt8]) -> [UInt8]? {
        guard !input.isEmpty else { return [] }

        var output = [UInt8]()
        let bufferSize = 8192
        var outputBuffer = [UInt8](repeating: 0, count: bufferSize)

        let success: Bool = input.withUnsafeBufferPointer { inPtr in
            outputBuffer.withUnsafeMutableBufferPointer { outPtr -> Bool in
                guard let inBase = inPtr.baseAddress, let outBase = outPtr.baseAddress else { return false }

                var stream = compression_stream(
                    dst_ptr: outBase,
                    dst_size: bufferSize,
                    src_ptr: inBase,
                    src_size: inPtr.count,
                    state: nil
                )
                guard compression_stream_init(&stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB) == COMPRESSION_STATUS_OK else {
                    return false
                }
                defer { compression_stream_destroy(&stream) }

                // compression_stream_init resets src_size/dst_size to 0 as a side effect —
                // (re)assign the source span after init, before the first process() call.
                stream.src_ptr = inBase
                stream.src_size = inPtr.count

                while true {
                    stream.dst_ptr = outBase
                    stream.dst_size = bufferSize
                    let status = compression_stream_process(&stream, Int32(COMPRESSION_STREAM_FINALIZE.rawValue))
                    let written = bufferSize - stream.dst_size
                    if written > 0 {
                        output.append(contentsOf: outPtr.prefix(written))
                    }
                    switch status {
                    case COMPRESSION_STATUS_OK:
                        continue
                    case COMPRESSION_STATUS_END:
                        return true
                    default:
                        return false
                    }
                }
            }
        }

        return success ? output : nil
    }
}
