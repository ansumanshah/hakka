import Foundation
import HakkaCommon

/// Pure display mapping for a rule entry — what the Rules surface shows for
/// each kind, kept out of the view so the vocabulary is testable.
public struct RuleEntryDisplay: Sendable, Equatable {
    public enum Kind: String, Sendable {
        case mock
        case breakpoint
    }

    public let kind: Kind
    /// The match key — pattern, plus method when the rule narrows to one.
    public let title: String
    /// What the rule does when it matches.
    public let subtitle: String

    public init(_ entry: RuleEntry) {
        switch entry.payload {
        case let .mock(rule):
            kind = .mock
            title = Self.title(pattern: rule.pattern, method: rule.method)
            if rule.block {
                subtitle = "Blocked"
            } else if rule.redirectTo != nil {
                subtitle = "Redirected"
            } else {
                subtitle = "Serves \(rule.response.status)"
            }
        case let .breakpoint(breakpoint):
            kind = .breakpoint
            title = Self.title(pattern: breakpoint.pattern, method: breakpoint.method)
            switch breakpoint.on {
            case .request: subtitle = "Pauses request"
            case .response: subtitle = "Pauses response"
            default: subtitle = "Pauses request + response"
            }
        }
    }

    private static func title(pattern: String, method: String?) -> String {
        method.map { "\($0) \(pattern)" } ?? pattern
    }
}
