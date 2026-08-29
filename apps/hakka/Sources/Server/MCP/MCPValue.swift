import Foundation

/// A generic JSON value — the one currency type this module uses for
/// anything whose shape isn't fixed at compile time: a JSON-RPC `id`
/// (string, number, or null — never known in advance), tool `arguments`
/// (each tool defines its own shape), and JSON-Schema tool descriptions
/// (nested objects/arrays of mixed primitive types).
///
/// Everywhere else in this file's sibling `BridgeWireFrame.swift` the
/// codebase reaches for `JSONSerialization` + `[String: Any]` for exactly
/// this "shape not known in advance" situation. That idiom doesn't carry
/// over here: `MCPTool.inputSchema` is a stored/computed property on a
/// `Sendable` protocol, and `Any` cannot satisfy `Sendable` under this
/// package's Swift 6 strict-concurrency mode — the compiler cannot prove a
/// boxed `Any` is safe to hand across an actor boundary, so a `[String:
/// Any]` stored property (or one returned across an `async` call, which
/// `MCPTool.call` is) fails to typecheck. `MCPValue` is a closed,
/// `Sendable`, `Codable` JSON tree that sidesteps the whole question.
public indirect enum MCPValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([MCPValue])
    case object([String: MCPValue])
}

extension MCPValue: Codable {
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([MCPValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: MCPValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:
            try container.encodeNil()
        case let .bool(value):
            try container.encode(value)
        case let .number(value):
            // A JSON-RPC `id` (and plenty of tool-schema fields) is
            // typically a small whole number; `Double`'s own JSON
            // formatting is not something this file controls, and printing
            // a request id of `1` back as `1.0` risks a stricter client
            // rejecting the round trip. Encoding the exact-integer case as
            // `Int64` sidesteps that regardless of how `JSONEncoder`
            // happens to format doubles.
            if value.truncatingRemainder(dividingBy: 1) == 0, let whole = Int64(exactly: value) {
                try container.encode(whole)
            } else {
                try container.encode(value)
            }
        case let .string(value):
            try container.encode(value)
        case let .array(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        }
    }
}

extension MCPValue {
    /// `self[key]` when `self` is `.object`, `nil` otherwise (including
    /// when the key is absent). Mirrors optional-chaining ergonomics for
    /// tool argument reading: `arguments["limit"]?.intValue`.
    public subscript(key: String) -> MCPValue? {
        guard case let .object(dict) = self else { return nil }
        return dict[key]
    }

    public var stringValue: String? {
        guard case let .string(value) = self else { return nil }
        return value
    }

    public var doubleValue: Double? {
        guard case let .number(value) = self else { return nil }
        return value
    }

    public var intValue: Int? {
        guard let value = doubleValue else { return nil }
        return Int(value)
    }

    public var objectValue: [String: MCPValue]? {
        guard case let .object(value) = self else { return nil }
        return value
    }

    /// JSON-encodes any `Encodable` value into an `MCPValue` tree by
    /// round-tripping it through `JSONEncoder`/`JSONDecoder` — the
    /// pragmatic way to turn a domain model (`NetworkRequest`, `RequestSpec`,
    /// `Collection`, ...) into this module's currency type without hand
    /// writing a mirror of every field. Never throws: a domain model that
    /// fails to encode is a bug in that model, not something a tool caller
    /// should see as a JSON-RPC-shaped failure, so this reports `.null`
    /// instead (a tool that gets `.null` back where it expected a request
    /// is very obviously wrong, which is the point).
    public static func encoded(_ value: some Encodable) -> MCPValue {
        guard let data = try? JSONEncoder().encode(value),
              let decoded = try? JSONDecoder().decode(MCPValue.self, from: data)
        else { return .null }
        return decoded
    }

    /// Serializes this value to compact JSON `Data` — used to build a tool
    /// result's `text` content and to write the final JSON-RPC response
    /// body. Never throws: every case above encodes unconditionally.
    public func jsonData() -> Data {
        (try? JSONEncoder().encode(self)) ?? Data("null".utf8)
    }
}
