import Foundation
import HakkaCommon

public struct AssertionResult: Sendable, Equatable, Identifiable {
    public let id: String
    public let target: AssertionTarget
    public let op: AssertionOperator
    public let expected: String
    public let actual: String?
    public let passed: Bool

    public init(id: String, target: AssertionTarget, op: AssertionOperator, expected: String, actual: String?, passed: Bool) {
        self.id = id
        self.target = target
        self.op = op
        self.expected = expected
        self.actual = actual
        self.passed = passed
    }
}

/// Evaluates one `Assertion` against a response. Declarative and total: every
/// `AssertionTarget`/`AssertionOperator` pair produces a result, never throws
/// — a malformed regex or an unparsable number just fails the assertion.
public enum AssertionEvaluator {
    public static func evaluate(_ assertion: Assertion, against record: NetworkRequest) -> AssertionResult {
        guard assertion.enabled else {
            return AssertionResult(id: assertion.id, target: assertion.target, op: assertion.op, expected: assertion.expected, actual: nil, passed: true)
        }
        let actual = ResponseFieldExtractor.value(for: assertion.target, in: record)
        return AssertionResult(
            id: assertion.id,
            target: assertion.target,
            op: assertion.op,
            expected: assertion.expected,
            actual: actual,
            passed: matches(op: assertion.op, actual: actual, expected: assertion.expected),
        )
    }

    private static func matches(op: AssertionOperator, actual: String?, expected: String) -> Bool {
        switch op {
        case .exists: actual != nil
        case .notExists: actual == nil
        case .equals: actual == expected
        case .notEquals: actual != expected
        case .contains: actual?.contains(expected) ?? false
        case .notContains: !(actual?.contains(expected) ?? false)
        case .matches: matchesRegex(actual: actual, pattern: expected)
        case .lessThan: compare(actual: actual, expected: expected, <)
        case .greaterThan: compare(actual: actual, expected: expected, >)
        }
    }

    private static func matchesRegex(actual: String?, pattern: String) -> Bool {
        guard let actual, let regex = try? Regex(pattern) else { return false }
        return (try? regex.firstMatch(in: actual)) != nil
    }

    private static func compare(actual: String?, expected: String, _ op: (Double, Double) -> Bool) -> Bool {
        guard let actual, let actualValue = Double(actual), let expectedValue = Double(expected) else { return false }
        return op(actualValue, expectedValue)
    }
}
