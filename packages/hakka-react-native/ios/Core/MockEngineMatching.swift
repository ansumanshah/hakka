// @generated — do not edit. Synced from ios/Sources/Common/MockEngineMatching.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - MockEngine matching
//
// Split out of `MockEngine.swift` to keep files under 200 lines. Reaches
// into `MockEngine`'s `rules`/`lock`/`matchCountsById` (module-internal, not
// `private` — see the comment on those properties in `MockEngine.swift`).

extension MockEngine {
    /// Called by `HakkaURLProtocol.startLoading()` before making the real
    /// network request. Returns the first matching enabled rule that is
    /// currently due to apply (see `admitMatchLocked`), or `nil`. Increments
    /// `hitCount` only on a rule that is actually returned/applied.
    public func match(url: String, method: String) -> MockRule? {
        lock.lock()
        defer { lock.unlock() }

        for i in rules.indices {
            let rule = rules[i]
            guard rule.enabled else { continue }

            if let ruleMethod = rule.method,
               ruleMethod.uppercased() != method.uppercased() {
                continue
            }

            if rule.isRegex {
                guard let regex = try? NSRegularExpression(pattern: rule.pattern, options: regexOptions(rule.regexFlags)),
                      regex.firstMatch(
                          in: url,
                          range: NSRange(url.startIndex..., in: url)
                      ) != nil
                else { continue }
            } else {
                guard url.contains(rule.pattern) else { continue }
            }

            // skipCount/stopAfter gate: consumes this rule's match budget.
            // A `false` result means this match should pass through as real,
            // unmodified traffic — treated the same as "no rule matched",
            // not "keep checking other rules" (this IS the matching rule;
            // it just isn't due to apply yet/anymore).
            guard admitMatchLocked(ruleIndex: i) else { return nil }

            rules[i].hitCount += 1
            return rules[i]
        }
        return nil
    }

    /// Consumes one unit of `rules[ruleIndex]`'s `skipCount`/`stopAfter`
    /// budget and decides whether this match should actually be applied.
    /// Must be called with `lock` already held (see `match(url:method:)`,
    /// the only caller) — this is not a public API, unlike the TS engine's
    /// `admitMatch`, because iOS's `match()` is already the single commit
    /// point per request (find + gate + record-hit in one locked call), so
    /// there is no separate `peek()`/`recordHit()` split to bridge here.
    func admitMatchLocked(ruleIndex: Int) -> Bool {
        let rule = rules[ruleIndex]
        let count = (matchCountsById[rule.id] ?? 0) + 1
        matchCountsById[rule.id] = count

        let skip = max(0, rule.skipCount)
        if count <= skip { return false }

        let appliedIndex = count - skip // 1-based: which applied-match this would be
        if let stopAfter = rule.stopAfter, appliedIndex > max(0, stopAfter) { return false }

        return true
    }

    func regexOptions(_ flags: String?) -> NSRegularExpression.Options {
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
