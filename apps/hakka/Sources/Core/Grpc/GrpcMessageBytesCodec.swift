import Foundation

/// Decodes the gRPC message editor's raw-mode text (ADR 0012) into bytes.
/// Accepts hex (with or without `0x`/whitespace) or base64 — hex is tried
/// first since it's unambiguous (only `[0-9a-fA-F]`), falling back to base64
/// for anything else, so a user pasting either format from `grpcurl`/protoc
/// tooling just works without picking a mode.
enum GrpcMessageBytesCodec {
    /// `nil` only when `text` is neither valid hex nor valid base64. An
    /// empty (or whitespace-only) string decodes to empty `Data` — a
    /// legitimate empty gRPC message (e.g. `google.protobuf.Empty`), not a
    /// refusal.
    static func decode(_ text: String) -> Data? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return Data() }
        if let hex = decodeHex(trimmed) { return hex }
        return Data(base64Encoded: trimmed)
    }

    private static func decodeHex(_ text: String) -> Data? {
        var cleaned = text
        if cleaned.hasPrefix("0x") || cleaned.hasPrefix("0X") { cleaned.removeFirst(2) }
        cleaned = cleaned.filter { !$0.isWhitespace }
        guard !cleaned.isEmpty, cleaned.count.isMultiple(of: 2) else { return nil }
        guard cleaned.allSatisfy(\.isHexDigit) else { return nil }

        var bytes = [UInt8]()
        bytes.reserveCapacity(cleaned.count / 2)
        var index = cleaned.startIndex
        while index < cleaned.endIndex {
            let next = cleaned.index(index, offsetBy: 2)
            guard let byte = UInt8(cleaned[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        return Data(bytes)
    }

    /// Hex text for display — the raw-mode editor's canonical round-trip
    /// format regardless of how a value first arrived.
    static func encodeHex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
