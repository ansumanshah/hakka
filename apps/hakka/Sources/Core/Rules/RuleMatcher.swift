import Foundation
import HakkaCommon

/// Pure rule matching for the desktop's observed-hit counting, mirroring the
/// device engines exactly — disabled rules never match, a set method narrows
/// case-insensitively, regex rules search the full URL with the same flag
/// mapping, and plain patterns are substrings of it. A breakpoint rule
/// matches regardless of phase: an observed request that hit the URL is a
/// hit, whether the device paused the request or the response half.
public enum RuleMatcher {
    public static func matches(_ entry: RuleEntry, url: String, method: String) -> Bool {
        guard entry.isEnabled else { return false }
        switch entry.payload {
        case let .mock(rule):
            guard methodMatches(rule.method, method: method) else { return false }
            if rule.isRegex {
                let regex = try? NSRegularExpression(pattern: rule.pattern, options: regexOptions(rule.regexFlags))
                return regex?.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)) != nil
            }
            return url.contains(rule.pattern)
        case let .breakpoint(breakpoint):
            guard methodMatches(breakpoint.method, method: method) else { return false }
            return url.contains(breakpoint.pattern)
        }
    }

    private static func methodMatches(_ ruleMethod: String?, method: String) -> Bool {
        ruleMethod.map { $0.uppercased() == method.uppercased() } ?? true
    }

    private static func regexOptions(_ flags: String?) -> NSRegularExpression.Options {
        guard let flags else { return [] }
        var options: NSRegularExpression.Options = []
        if flags.contains("i") {
            options.insert(.caseInsensitive)
        }
        if flags.contains("m") {
            options.insert(.anchorsMatchLines)
        }
        if flags.contains("s") {
            options.insert(.dotMatchesLineSeparators)
        }
        return options
    }
}
