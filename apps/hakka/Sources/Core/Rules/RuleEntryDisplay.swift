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
    /// `title`'s two halves, split out for a row that shows the method as
    /// its own chip rather than folded into one string (`title`/`subtitle`
    /// stay as they are — accessibility labels and any other reader that
    /// wants the combined form still gets it).
    public let pattern: String
    public let method: String?

    public init(_ entry: RuleEntry) {
        switch entry.payload {
        case let .mock(rule):
            kind = .mock
            pattern = rule.pattern
            method = rule.method
            title = Self.title(pattern: rule.pattern, method: rule.method)
            var base: String
            if let failure = rule.failure {
                base = "Fails: \(failure.code.displayName)"
            } else if rule.block {
                base = "Blocked"
            } else if rule.redirectTo != nil {
                base = "Redirected"
            } else {
                base = "Serves \(rule.response.status)"
            }
            if let budget = Self.skipStopSuffix(rule) {
                base += " (\(budget))"
            }
            subtitle = base
        case let .breakpoint(breakpoint):
            kind = .breakpoint
            pattern = breakpoint.pattern
            method = breakpoint.method
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

    /// "skip 2", "stop after 5", or "skip 2 · stop after 5" — the budget's
    /// *configuration*, not live progress through it. The control channel is
    /// fire-and-forget with no feedback frame, so the desktop cannot show how
    /// far into that budget a device actually is — see `RuleEntry.hitCount`'s
    /// doc for the same limitation on match counts.
    private static func skipStopSuffix(_ rule: MockRuleInput) -> String? {
        var parts: [String] = []
        if rule.skipCount > 0 { parts.append("skip \(rule.skipCount)") }
        if let stopAfter = rule.stopAfter { parts.append("stop after \(stopAfter)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
