import Foundation
import HakkaCommon

/// Turns raw search-bar text into a `TrafficQuery`.
///
/// `TrafficQuery` is the structured form the compiler consumes; until now
/// nothing produced one from text, so the search DSL existed but nobody could
/// type into it. Mirrors `parser.ts` in `packages/hakka-core/src/query/`, and
/// reuses `HakkaCommon.parseSearchTokens` for the scope/negate/regex/wildcard/
/// quoting rules rather than reimplementing them — that parser already ships in
/// the iOS SDK and the two must agree.
///
/// Filter tokens are recognised and removed before the rest becomes free-text:
///
/// - `method:GET`, `host:api.example.com`, `type:json`
/// - `dur>100`, `dur<=500` — milliseconds
/// - `size>1kb`, `size<2mb` — `b`/`kb`/`mb`, default bytes
/// - `2xx`, `>=400`, `200..299`, `404` — status, per `TrafficStatusDsl`
/// - `sort:duration`, `order:asc`
public enum TrafficQueryParser {
    public static func parse(_ raw: String) -> TrafficQuery {
        var query = TrafficQuery()
        var freeText: [String] = []

        for part in splitRespectingQuotes(raw) where !part.isEmpty {
            if applyFilter(part, to: &query) { continue }
            freeText.append(part)
        }

        // Re-quote anything containing a space before handing it back to
        // `parseSearchTokens`, which splits on whitespace again — otherwise
        // splitting here to find filters would silently tear a quoted phrase
        // into separate tokens.
        let remaining = freeText.map { $0.contains(" ") ? "\"\($0)\"" : $0 }.joined(separator: " ")
        query.tokens = parseSearchTokens(remaining).map(Self.token)
        return query
    }

    /// Returns true when `part` was consumed as a structured filter.
    private static func applyFilter(_ part: String, to query: inout TrafficQuery) -> Bool {
        let lower = part.lowercased()

        if let value = prefixValue(lower, "method:") {
            query.method = value
            return true
        }
        if let value = prefixValue(lower, "host:") {
            query.host = value
            return true
        }
        if let value = prefixValue(lower, "type:") ?? prefixValue(lower, "content-type:") {
            query.contentType = value
            return true
        }
        if let value = prefixValue(lower, "sort:"), let field = TrafficSortField(rawValue: value) {
            query.sort = field
            return true
        }
        if let value = prefixValue(lower, "order:"), let order = TrafficSortOrder(rawValue: value) {
            query.order = order
            return true
        }
        if applyRange(lower, prefix: "dur", scale: { Int64($0) }, min: &query.durationMin, max: &query.durationMax) {
            return true
        }
        if applyRange(lower, prefix: "size", scale: Self.bytes, min: &query.sizeMin, max: &query.sizeMax) {
            return true
        }
        // Status last: `404` is a bare token, so anything that looks like a
        // status range only counts once the named filters have had their turn.
        if TrafficStatusDsl.parse(part) != nil {
            query.statusDsl = part
            return true
        }
        return false
    }

    private static func prefixValue(_ lower: String, _ prefix: String) -> String? {
        guard lower.hasPrefix(prefix) else { return nil }
        let value = String(lower.dropFirst(prefix.count))
        return value.isEmpty ? nil : value
    }

    /// `dur>100`, `size<=2mb`. `>`/`<` shift the inclusive bound by one, the
    /// same convention `parser.ts` uses, so `dur>100` excludes exactly 100.
    private static func applyRange(
        _ lower: String,
        prefix: String,
        scale: (String) -> Int64?,
        min: inout Int64?,
        max: inout Int64?,
    ) -> Bool {
        guard lower.hasPrefix(prefix) else { return false }
        var rest = String(lower.dropFirst(prefix.count))

        let inclusive = rest.hasPrefix(">=") || rest.hasPrefix("<=")
        let isLowerBound = rest.hasPrefix(">")
        let isUpperBound = rest.hasPrefix("<")
        guard isLowerBound || isUpperBound else { return false }

        rest = String(rest.dropFirst(inclusive ? 2 : 1))
        guard let value = scale(rest) else { return false }

        // `&+ 1` would wrap and `+ 1` would trap; both are reachable by typing
        // `dur>9223372036854775807`. Clamping keeps an absurd bound absurd.
        if isLowerBound {
            min = inclusive ? value : (value == .max ? .max : value + 1)
        } else {
            max = inclusive ? value : (value == .min ? .min : value - 1)
        }
        return true
    }

    /// `"1kb"` → 1024. A bare number is bytes.
    ///
    /// Saturates rather than multiplying straight through: this reads a search
    /// field, and `size>9223372036854775807mb` parses to a valid `Int64` that
    /// then traps on the multiply. A nonsensical bound clamped to `Int64.max`
    /// matches nothing, which is the right answer; a crash is not.
    private static func bytes(_ raw: String) -> Int64? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        for (suffix, multiplier) in [("mb", 1024 * 1024), ("kb", 1024), ("b", 1)] {
            guard trimmed.hasSuffix(suffix) else { continue }
            guard let value = Int64(trimmed.dropLast(suffix.count)) else { return nil }
            let (scaled, overflowed) = value.multipliedReportingOverflow(by: Int64(multiplier))
            return overflowed ? (value < 0 ? .min : .max) : scaled
        }
        return Int64(trimmed)
    }

    private static func token(_ parsed: SearchToken) -> TrafficSearchToken {
        TrafficSearchToken(
            scope: TrafficSearchScope(rawValue: parsed.scope.rawValue) ?? .all,
            mode: TrafficSearchMode(rawValue: parsed.mode.rawValue) ?? .substring,
            value: parsed.value,
            negate: parsed.negate,
        )
    }

    /// Quoted phrases stay one part, so `host:"a b"` and `"two words"` survive
    /// the filter split intact.
    private static func splitRespectingQuotes(_ input: String) -> [String] {
        var results: [String] = []
        var current = ""
        var quote: Character?

        for character in input {
            if let open = quote {
                if character == open {
                    quote = nil
                } else {
                    current.append(character)
                }
            } else if character == "\"" || character == "'" {
                quote = character
            } else if character == " " || character == "\t" {
                if !current.isEmpty {
                    results.append(current)
                    current = ""
                }
            } else {
                current.append(character)
            }
        }
        if !current.isEmpty { results.append(current) }
        return results
    }
}
