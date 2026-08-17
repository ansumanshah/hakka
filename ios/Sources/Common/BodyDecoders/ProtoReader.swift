import Foundation

/// Wire types defined by the protobuf encoding spec.
public enum ProtoWireType: Int, Equatable, Sendable {
    case varint = 0
    case fixed64 = 1
    case lengthDelimited = 2
    case fixed32 = 5
}

/// The decoded value of a single protobuf field in the best-effort field tree.
/// Modeled as an enum since Swift has no dynamic union type — the JS
/// `ProtoField.value` union (`bigint | number | string | ProtoField[]`) is
/// represented here as one case per wire-type/classification outcome.
public enum ProtoFieldValue: Equatable, Sendable {
    /// wireType 0 — full 64-bit unsigned varint value.
    case varint(UInt64)
    /// wireType 1 — raw fixed64 bits, also reinterpreted as a double.
    case fixed64(bits: UInt64, double: Double)
    /// wireType 5 — raw fixed32 bits, also reinterpreted as a float.
    case fixed32(bits: UInt32, float: Float)
    /// wireType 2, decoded cleanly as a nested sub-message.
    case message([ProtoField])
    /// wireType 2, classified as printable UTF-8 text.
    case string(String)
    /// wireType 2, fallback hex-encoded raw bytes.
    case bytes(hex: String)
}

/// A single decoded protobuf field, best-effort (no `.proto` schema).
/// Port of `decoders.ts`'s `ProtoField` interface.
public struct ProtoField: Equatable, Sendable {
    public let field: Int
    public let wireType: ProtoWireType
    public let value: ProtoFieldValue

    public init(field: Int, wireType: ProtoWireType, value: ProtoFieldValue) {
        self.field = field
        self.wireType = wireType
        self.value = value
    }
}

/// Errors thrown while walking the wire format — always caught internally by
/// `decodeProtobuf`'s best-effort recovery, mirroring `decoders.ts`'s use of
/// plain `throw`/`catch` for the same control flow.
enum ProtoDecodeError: Error {
    case unexpectedEOF
    case varintTooLong
    case invalidFieldNumber
    case unsupportedWireType(Int)
}

/// A forward-only cursor over raw protobuf wire-format bytes. Port of
/// `decoders.ts`'s `ProtoReader`.
final class ProtoReader {
    private let bytes: [UInt8]
    private(set) var pos = 0

    init(_ bytes: [UInt8]) { self.bytes = bytes }

    var remaining: Int { bytes.count - pos }
    var isAtEnd: Bool { pos >= bytes.count }

    func readByte() throws -> UInt8 {
        guard pos < bytes.count else { throw ProtoDecodeError.unexpectedEOF }
        defer { pos += 1 }
        return bytes[pos]
    }

    /// Reads a base-128 varint (up to 10 bytes / 64 bits).
    func readVarint() throws -> UInt64 {
        var result: UInt64 = 0
        var shift: UInt64 = 0
        for _ in 0..<10 {
            let b = try readByte()
            result |= UInt64(b & 0x7f) << shift
            if b & 0x80 == 0 { return result }
            shift += 7
        }
        throw ProtoDecodeError.varintTooLong
    }

    func readFixed64() throws -> UInt64 {
        guard remaining >= 8 else { throw ProtoDecodeError.unexpectedEOF }
        var result: UInt64 = 0
        for i in 0..<8 {
            result |= UInt64(bytes[pos + i]) << (8 * i)
        }
        pos += 8
        return result
    }

    func readFixed32() throws -> UInt32 {
        guard remaining >= 4 else { throw ProtoDecodeError.unexpectedEOF }
        let b0 = UInt32(bytes[pos])
        let b1 = UInt32(bytes[pos + 1])
        let b2 = UInt32(bytes[pos + 2])
        let b3 = UInt32(bytes[pos + 3])
        pos += 4
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    }

    func readBytes(_ len: Int) throws -> [UInt8] {
        guard len >= 0, remaining >= len else { throw ProtoDecodeError.unexpectedEOF }
        let slice = Array(bytes[pos..<(pos + len)])
        pos += len
        return slice
    }
}
