import Foundation

/// A response assertion. Deliberately declarative (no embedded scripting
/// language): assertions stay diffable, runnable headlessly by the CLI, and
/// safe to execute without a JS sandbox in a native app.
public struct Assertion: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    public var target: AssertionTarget
    public var op: AssertionOperator
    public var expected: String
    public var enabled: Bool

    public init(
        id: String = UUID().uuidString,
        target: AssertionTarget,
        op: AssertionOperator,
        expected: String,
        enabled: Bool = true,
    ) {
        self.id = id
        self.target = target
        self.op = op
        self.expected = expected
        self.enabled = enabled
    }
}

public enum AssertionTarget: Sendable, Codable, Equatable {
    case status
    case durationMs
    case header(name: String)
    /// Dot/bracket path into a JSON response body, e.g. `data.items[0].id`.
    case jsonPath(String)
    case bodyText
}

public enum AssertionOperator: String, Sendable, Codable, Equatable, CaseIterable {
    case equals
    case notEquals
    case contains
    case notContains
    case matches
    case lessThan
    case greaterThan
    case exists
    case notExists
}

/// Extract a value from a response into an environment variable.
public struct ResponseCapture: Sendable, Codable, Equatable, Identifiable {
    public let id: String
    /// Variable name to write (without braces).
    public var variable: String
    public var source: AssertionTarget
    public var enabled: Bool

    public init(id: String = UUID().uuidString, variable: String, source: AssertionTarget, enabled: Bool = true) {
        self.id = id
        self.variable = variable
        self.source = source
        self.enabled = enabled
    }
}
