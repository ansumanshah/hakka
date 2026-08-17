import Foundation

// MARK: - MockResponse

/// Response to return when a mock rule matches (no-op).
public struct MockResponse: Sendable {
    /// HTTP status code. Default: 200.
    public let status: Int
    /// Response headers.
    public let headers: [String: String]
    /// Response body as a string, or `nil` for an empty body.
    public let body: String?
    /// Artificial delay in seconds before responding. 0 = instant.
    public let delay: TimeInterval

    public init(
        status: Int = 200,
        headers: [String: String] = [:],
        body: String? = nil,
        delay: TimeInterval = 0
    ) {
        self.status = status
        self.headers = headers
        self.body = body
        self.delay = delay
    }
}

// MARK: - MockRule

/// Rule matching incoming requests (no-op).
public struct MockRule: Sendable, Identifiable {
    /// Unique identifier assigned by `MockEngine.addRule(_:)`.
    public let id: String
    /// URL substring or regex pattern to match against.
    public let pattern: String
    /// When `true`, `pattern` is treated as a regular expression.
    public let isRegex: Bool
    /// HTTP method filter. `nil` matches all methods.
    public let method: String?
    /// Response to return when this rule matches.
    public let response: MockResponse
    /// Whether the rule is active.
    public var enabled: Bool
    /// Number of times this rule has been matched.
    public var hitCount: Int
    /// Regular expression flags passed from JS mock rules.
    public let regexFlags: String?
}

// MARK: - MockRuleInput

/// Input for adding a new rule (without id/hitCount).
public struct MockRuleInput: Sendable {
    public let pattern: String
    public let isRegex: Bool
    public let method: String?
    public let response: MockResponse
    public let enabled: Bool
    public let regexFlags: String?

    public init(
        pattern: String,
        isRegex: Bool = false,
        method: String? = nil,
        response: MockResponse,
        enabled: Bool = true
    ) {
        self.init(
            pattern: pattern,
            isRegex: isRegex,
            regexFlags: nil,
            method: method,
            response: response,
            enabled: enabled
        )
    }

    public init(
        pattern: String,
        isRegex: Bool = false,
        regexFlags: String?,
        method: String? = nil,
        response: MockResponse,
        enabled: Bool = true
    ) {
        self.pattern = pattern
        self.isRegex = isRegex
        self.regexFlags = regexFlags
        self.method = method
        self.response = response
        self.enabled = enabled
    }
}

// MARK: - MockEngine

/// No-op mock engine. All rule operations are discarded,
/// `match` always returns `nil`.
public final class MockEngine: @unchecked Sendable {
    /// Shared singleton.
    public static let shared = MockEngine()

    public init() {}

    // MARK: - Rule management

    /// No-op. Returns a placeholder ID.
    @discardableResult
    public func addRule(_ input: MockRuleInput) -> String {
        addRule(input, id: nil)
    }

    /// No-op. Returns the caller-provided ID when supplied.
    @discardableResult
    public func addRule(_ input: MockRuleInput, id providedId: String?) -> String {
        if let providedId, !providedId.isEmpty {
            return providedId
        }
        return "noop_0"
    }

    /// No-op.
    public func removeRule(id: String) {}

    /// No-op.
    public func enableRule(id: String) {}

    /// No-op.
    public func disableRule(id: String) {}

    /// Always empty.
    public func getRules() -> [MockRule] { [] }

    /// No-op.
    public func clearRules() {}

    /// No-op.
    public func setGlobalDelay(_ delay: TimeInterval) {}

    /// Always 0.
    public func getGlobalDelay() -> TimeInterval { 0 }

    // MARK: - Matching

    /// Always `nil`.
    public func match(url: String, method: String) -> MockRule? { nil }
}
