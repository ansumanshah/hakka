import CoreFoundation
import Foundation

/// A bounded, read-only summary of JSON-RPC 2.0 request and response bodies.
///
/// The parser accepts only objects that meet the protocol's required shape:
/// an exact `jsonrpc: "2.0"` marker, a string method for requests, and exactly
/// one of `result` or `error` for responses. It deliberately keeps only
/// protocol facts, never parameter, result, or error-data payloads.
public struct JSONRPCSummary: Sendable, Equatable {
    /// Prevents a detail selection from decoding an arbitrarily large body.
    public static let defaultMaximumBodyBytes = 64 * 1024
    /// Prevents a batch from expanding the Overview into an unbounded list.
    public static let defaultMaximumBatchMessages = 32

    public let request: Body?
    public let response: Body?

    public init?(
        requestBody: String?,
        responseBody: String?,
        maximumBodyBytes: Int = defaultMaximumBodyBytes,
        maximumBatchMessages: Int = defaultMaximumBatchMessages
    ) {
        guard maximumBodyBytes >= 0, maximumBatchMessages > 0 else { return nil }
        request = Self.parse(
            requestBody,
            direction: .request,
            maximumBodyBytes: maximumBodyBytes,
            maximumBatchMessages: maximumBatchMessages
        )
        response = Self.parse(
            responseBody,
            direction: .response,
            maximumBodyBytes: maximumBodyBytes,
            maximumBatchMessages: maximumBatchMessages
        )
        guard request != nil || response != nil else { return nil }
    }

    public struct Body: Sendable, Equatable {
        public let messages: [Message]
        public let isBatch: Bool

        public var messageCount: Int { messages.count }
    }

    public struct Message: Sendable, Equatable {
        public let method: String?
        public let id: Identifier?
        public let isNotification: Bool
        public let hasResult: Bool
        public let errorCode: Int?
    }

    public enum Identifier: Sendable, Equatable {
        case string(String)
        case number(String)
        case null

        public var displayValue: String {
            switch self {
            case let .string(value): value
            case let .number(value): value
            case .null: "null"
            }
        }
    }

    private enum Direction {
        case request
        case response
    }

    private static func parse(
        _ body: String?,
        direction: Direction,
        maximumBodyBytes: Int,
        maximumBatchMessages: Int
    ) -> Body? {
        guard let body, body.utf8.count <= maximumBodyBytes,
              let data = body.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) else {
            return nil
        }

        if let object = root as? [String: Any], let message = parse(object, direction: direction) {
            return Body(messages: [message], isBatch: false)
        }
        guard let objects = root as? [Any], !objects.isEmpty, objects.count <= maximumBatchMessages else {
            return nil
        }
        let messages = objects.compactMap { value -> Message? in
            guard let object = value as? [String: Any] else { return nil }
            return parse(object, direction: direction)
        }
        guard messages.count == objects.count else { return nil }
        return Body(messages: messages, isBatch: true)
    }

    private static func parse(_ object: [String: Any], direction: Direction) -> Message? {
        guard object["jsonrpc"] as? String == "2.0" else { return nil }
        switch direction {
        case .request:
            guard let method = object["method"] as? String,
                  validParams(object["params"]),
                  let id = validRequestIdentifier(object) else {
                return nil
            }
            return Message(
                method: method,
                id: id.value,
                isNotification: !id.isPresent,
                hasResult: false,
                errorCode: nil
            )
        case .response:
            guard object["method"] == nil,
                  let id = validRequiredIdentifier(object),
                  let outcome = validResponseOutcome(object) else {
                return nil
            }
            return Message(
                method: nil,
                id: id,
                isNotification: false,
                hasResult: outcome.hasResult,
                errorCode: outcome.errorCode
            )
        }
    }

    private static func validParams(_ value: Any?) -> Bool {
        guard let value else { return true }
        return value is [Any] || value is [String: Any]
    }

    private static func validRequestIdentifier(_ object: [String: Any]) -> (isPresent: Bool, value: Identifier?)? {
        guard let value = object["id"] else { return (false, nil) }
        guard let identifier = identifier(from: value) else { return nil }
        return (true, identifier)
    }

    private static func validRequiredIdentifier(_ object: [String: Any]) -> Identifier? {
        guard let value = object["id"] else { return nil }
        return identifier(from: value)
    }

    private static func identifier(from value: Any) -> Identifier? {
        if value is NSNull { return .null }
        if let value = value as? String { return .string(value) }
        guard let value = value as? NSNumber, !isBoolean(value) else { return nil }
        return .number(value.stringValue)
    }

    private static func validResponseOutcome(_ object: [String: Any]) -> (hasResult: Bool, errorCode: Int?)? {
        let hasResult = object["result"] != nil
        let hasError = object["error"] != nil
        guard hasResult != hasError else { return nil }
        guard hasError else { return (true, nil) }
        guard let error = object["error"] as? [String: Any],
              let code = integer(from: error["code"]),
              error["message"] is String else {
            return nil
        }
        return (false, code)
    }

    private static func integer(from value: Any?) -> Int? {
        guard let number = value as? NSNumber, !isBoolean(number) else { return nil }
        let decimal = number.doubleValue
        guard decimal.isFinite,
              decimal.rounded(.towardZero) == decimal,
              let integer = Int(exactly: decimal) else {
            return nil
        }
        return integer
    }

    private static func isBoolean(_ number: NSNumber) -> Bool {
        CFGetTypeID(number) == CFBooleanGetTypeID()
    }
}
