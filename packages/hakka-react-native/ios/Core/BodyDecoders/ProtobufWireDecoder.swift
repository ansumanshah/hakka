// @generated — do not edit. Synced from ios/Sources/Common/BodyDecoders/ProtobufWireDecoder.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// True when `bytes` looks like valid, printable-ish UTF-8 text — used to
/// decide whether a length-delimited field renders as a string vs. raw hex
/// bytes. Port of `decoders.ts`'s `looksLikeUtf8Text`.
func looksLikeUtf8Text(_ bytes: [UInt8]) -> Bool {
    if bytes.isEmpty { return true }
    var i = 0
    var printable = 0
    while i < bytes.count {
        let b = bytes[i]
        if b == 0x09 || b == 0x0a || b == 0x0d {
            printable += 1
            i += 1
            continue
        }
        if b < 0x20 || b == 0x7f { return false }
        if b < 0x80 {
            printable += 1
            i += 1
            continue
        }
        let extra: Int
        if b & 0xe0 == 0xc0 { extra = 1 }
        else if b & 0xf0 == 0xe0 { extra = 2 }
        else if b & 0xf8 == 0xf0 { extra = 3 }
        else { return false }
        guard i + extra < bytes.count else { return false }
        for j in 1...extra where bytes[i + j] & 0xc0 != 0x80 {
            return false
        }
        printable += 1
        i += extra + 1
    }
    return printable > 0
}

private func bytesToHex(_ bytes: [UInt8]) -> String {
    bytes.map { String(format: "%02x", $0) }.joined()
}

/// Classification outcome for a length-delimited (wire type 2) payload.
private enum ClassifiedLengthDelimited {
    case message([ProtoField])
    case string(String)
    case bytes(String)
}

/// Attempt to parse `bytes` as a nested protobuf sub-message. Returns the
/// field tree on success, or `nil` if the bytes don't parse cleanly.
private func tryParseSubMessage(_ bytes: [UInt8]) -> [ProtoField]? {
    if bytes.isEmpty { return [] }
    guard let fields = try? parseProtoFields(ProtoReader(bytes)), !fields.isEmpty else { return nil }
    return fields
}

/// Classify a length-delimited payload as a nested sub-message, a UTF-8
/// string, or raw bytes. Plain printable text wins over an ambiguous
/// sub-message interpretation. Port of `decoders.ts`'s `classifyLengthDelimited`.
private func classifyLengthDelimited(_ raw: [UInt8]) -> ClassifiedLengthDelimited {
    guard looksLikeUtf8Text(raw) else {
        if let sub = tryParseSubMessage(raw) {
            return .message(sub)
        }
        return .bytes(bytesToHex(raw))
    }
    return .string(String(decoding: raw, as: UTF8.self))
}

/// Parses all top-level fields out of `reader` until EOF. Throws on malformed
/// data. Port of `decoders.ts`'s `parseProtoFields`.
func parseProtoFields(_ reader: ProtoReader) throws -> [ProtoField] {
    var fields: [ProtoField] = []
    while !reader.isAtEnd {
        let tag = try reader.readVarint()
        let fieldNum = Int(tag >> 3)
        guard fieldNum >= 1 else { throw ProtoDecodeError.invalidFieldNumber }
        guard let wireType = ProtoWireType(rawValue: Int(tag & 0x7)) else {
            throw ProtoDecodeError.unsupportedWireType(Int(tag & 0x7))
        }
        fields.append(try readField(fieldNum, wireType, reader))
    }
    return fields
}

private func readField(_ fieldNum: Int, _ wireType: ProtoWireType, _ reader: ProtoReader) throws -> ProtoField {
    switch wireType {
    case .varint:
        return ProtoField(field: fieldNum, wireType: wireType, value: .varint(try reader.readVarint()))
    case .fixed64:
        let bits = try reader.readFixed64()
        return ProtoField(field: fieldNum, wireType: wireType, value: .fixed64(bits: bits, double: Double(bitPattern: bits)))
    case .fixed32:
        let bits = try reader.readFixed32()
        return ProtoField(field: fieldNum, wireType: wireType, value: .fixed32(bits: bits, float: Float(bitPattern: bits)))
    case .lengthDelimited:
        let len = Int(try reader.readVarint())
        let raw = try reader.readBytes(len)
        switch classifyLengthDelimited(raw) {
        case .message(let sub): return ProtoField(field: fieldNum, wireType: wireType, value: .message(sub))
        case .string(let s): return ProtoField(field: fieldNum, wireType: wireType, value: .string(s))
        case .bytes(let hex): return ProtoField(field: fieldNum, wireType: wireType, value: .bytes(hex: hex))
        }
    }
}

/// Best-effort protobuf wire-format decoder — no `.proto` schema required.
/// Never throws: malformed/truncated input yields a partial field tree (or an
/// empty array). Port of `decoders.ts`'s `decodeProtobuf`.
public func decodeProtobuf(_ bytes: [UInt8]) -> [ProtoField] {
    if let fields = try? parseProtoFields(ProtoReader(bytes)) {
        return fields
    }

    // Best-effort partial-recovery: re-parse field by field, collecting a
    // partial tree until the point of failure so a malformed tail doesn't
    // erase an otherwise-valid prefix.
    var partial: [ProtoField] = []
    let reader = ProtoReader(bytes)
    while !reader.isAtEnd {
        let before = reader.remaining
        do {
            let tag = try reader.readVarint()
            let fieldNum = Int(tag >> 3)
            guard fieldNum >= 1, let wireType = ProtoWireType(rawValue: Int(tag & 0x7)) else { break }
            partial.append(try readField(fieldNum, wireType, reader))
        } catch {
            break
        }
        // Safety valve: stop if no progress was made, to avoid an infinite loop.
        if reader.remaining >= before { break }
    }
    return partial
}

/// Render a `ProtoField` tree as an indented, human-readable string. Port of
/// `decoders.ts`'s `formatProtoFields` templates.
func formatProtoFields(_ fields: [ProtoField], indent: Int = 0) -> String {
    let pad = String(repeating: "  ", count: indent)
    var lines: [String] = []
    for f in fields {
        switch f.value {
        case .message(let sub):
            lines.append("\(pad)\(f.field) (message):")
            lines.append(formatProtoFields(sub, indent: indent + 1))
        case .string(let s):
            lines.append("\(pad)\(f.field) (string): \(jsonQuoted(s))")
        case .bytes(let hex):
            lines.append("\(pad)\(f.field) (bytes): \(hex)")
        case .fixed64(let bits, let double):
            lines.append("\(pad)\(f.field) (fixed64): \(bits) (double: \(double))")
        case .fixed32(let bits, let float):
            lines.append("\(pad)\(f.field) (fixed32): \(bits) (float: \(float))")
        case .varint(let value):
            lines.append("\(pad)\(f.field) (varint): \(value)")
        }
    }
    return lines.joined(separator: "\n")
}

/// JSON-quotes a string like `JSON.stringify` (wraps in double quotes, escapes
/// control characters/quotes/backslashes). Encoding a single top-level string
/// has no keys to reorder, so — unlike the SSE event array — `JSONEncoder` is
/// safe to use here.
func jsonQuoted(_ s: String) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    guard let data = try? encoder.encode(s), let json = String(data: data, encoding: .utf8) else {
        return "\"\(s)\""
    }
    return json
}
