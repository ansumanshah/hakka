import Foundation

/// A pluggable transform for captured request/response bodies. Decoders run in
/// registration order; the first non-`nil` result wins. Port of
/// `packages/hakka-core/src/engine/decoders.ts`'s `BodyDecoder` interface.
public protocol HakkaBodyDecoder {
    /// Unique identifier for this decoder (e.g. "gzip", "sse", "protobuf-wire").
    var id: String { get }

    /// Attempt to decode `body`. Return `nil` to defer to the next decoder.
    func decode(_ body: String, contentType: String?, contentEncoding: String?) -> String?
}

/// Registry of body decoders, run in order until one returns non-`nil`; falls
/// back to the raw body unchanged (passthrough) when none match. Port of
/// `decoders.ts`'s `BodyDecoderRegistry`.
public final class BodyDecoderRegistry: @unchecked Sendable {
    private var decoders: [HakkaBodyDecoder] = []
    private let lock = NSLock()

    public init() {}

    /// Register a decoder. Decoders added earlier take precedence.
    /// Registering a decoder with a duplicate id replaces the existing one.
    public func register(_ decoder: HakkaBodyDecoder) {
        lock.lock()
        defer { lock.unlock() }
        if let idx = decoders.firstIndex(where: { $0.id == decoder.id }) {
            decoders[idx] = decoder
        } else {
            decoders.append(decoder)
        }
    }

    /// Run the decoder pipeline, returning the first non-`nil` result or the
    /// raw body unchanged (passthrough) if no decoder matches.
    public func decode(_ body: String, contentType: String?, contentEncoding: String? = nil) -> String {
        lock.lock()
        let snapshot = decoders
        lock.unlock()
        for decoder in snapshot {
            if let result = decoder.decode(body, contentType: contentType, contentEncoding: contentEncoding) {
                return result
            }
        }
        return body
    }
}

// MARK: - Shared helpers

/// Strips parameters and lowercases a MIME-type-shaped header value:
/// "application/x-protobuf; charset=binary" -> "application/x-protobuf".
/// Port of the `contentType.toLowerCase().split(';')[0]?.trim()` pattern
/// repeated across `decoders.ts`'s content-type-gated decoders.
func hakkaNormalizedMimeType(_ value: String?) -> String? {
    guard let value else { return nil }
    let lower = value.lowercased()
    guard let semi = lower.firstIndex(of: ";") else {
        return lower.trimmingCharacters(in: .whitespaces)
    }
    return String(lower[lower.startIndex..<semi]).trimmingCharacters(in: .whitespaces)
}

/// True when `enc` contains `token` in its comma-separated, case-insensitive
/// list (e.g. `Content-Encoding: "gzip, br"`). Port of `decoders.ts`'s `hasEncoding`.
func hakkaHasEncoding(_ enc: String?, token: String) -> Bool {
    guard let enc else { return false }
    return enc.lowercased().split(separator: ",").contains { $0.trimmingCharacters(in: .whitespaces) == token }
}

/// Pure lenient base64 -> bytes decoder matching `decoders.ts`'s `base64ToBytes`:
/// ignores invalid characters, stops at the first `=` padding character, and
/// returns `nil` only when the input is non-empty but yields zero valid sextets.
func hakkaBase64Decode(_ b64: String) -> [UInt8]? {
    var sextets: [UInt8] = []
    sextets.reserveCapacity(b64.count)
    for scalar in b64.unicodeScalars {
        if scalar == "=" { break }
        guard let v = hakkaBase64Lookup(scalar) else { continue }
        sextets.append(v)
    }
    let n = sextets.count
    if n == 0 { return b64.isEmpty ? [] : nil }
    let outLen = (n * 6) / 8
    var bytes = [UInt8](repeating: 0, count: outLen)
    var acc: UInt32 = 0
    var bits = 0
    var o = 0
    for s in sextets {
        acc = (acc << 6) | UInt32(s)
        bits += 6
        if bits >= 8 {
            bits -= 8
            bytes[o] = UInt8((acc >> UInt32(bits)) & 0xff)
            o += 1
        }
    }
    return bytes
}

private func hakkaBase64Lookup(_ scalar: Unicode.Scalar) -> UInt8? {
    let c = scalar.value
    switch c {
    case 65...90: return UInt8(c - 65) // A-Z
    case 97...122: return UInt8(c - 97 + 26) // a-z
    case 48...57: return UInt8(c - 48 + 52) // 0-9
    case 43: return 62 // +
    case 47: return 63 // /
    default: return nil
    }
}
