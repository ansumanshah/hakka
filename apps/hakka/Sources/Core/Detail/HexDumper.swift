import Foundation

/// Formats binary bodies as an offset/hex/ASCII dump. Pure — the viewer
/// hands it bytes and renders the string it gets back.
public enum HexDumper {
    /// Bytes shown before the dump truncates; matches the order of magnitude
    /// of the text viewers' character cap.
    public static let defaultByteLimit = 16 * 1024

    private static let bytesPerLine = 16

    public static func dump(_ bytes: [UInt8], limit: Int = defaultByteLimit) -> String {
        let shown = bytes.prefix(max(0, limit))
        guard !shown.isEmpty else { return "" }

        var lines: [String] = []
        lines.reserveCapacity(shown.count / bytesPerLine + 1)
        var offset = 0
        for line in stride(from: 0, to: shown.count, by: bytesPerLine) {
            let lineBytes = Array(shown[line..<min(line + bytesPerLine, shown.count)])
            lines.append(Self.line(lineBytes, offset: offset))
            offset += lineBytes.count
        }
        if bytes.count > limit {
            lines.append("… \(bytes.count - limit) more bytes not shown")
        }
        return lines.joined(separator: "\n")
    }

    /// One dump row: eight-digit hex offset, the byte columns padded to a
    /// fixed width so every row's ASCII gutter lines up, then printable
    /// ASCII between pipes.
    private static func line(_ bytes: [UInt8], offset: Int) -> String {
        let hex = bytes.map { String(format: "%02x", $0) }.joined(separator: " ")
        let paddedHex = hex.padding(toLength: bytesPerLine * 3 - 1, withPad: " ", startingAt: 0)
        let ascii = String(decoding: bytes.map { (32...126).contains($0) ? $0 : UInt8(ascii: ".") }, as: UTF8.self)
        return String(format: "%08x  %@  |%@|", offset, paddedHex, ascii)
    }
}
