import Foundation

// MARK: - Types

/// Which field(s) of a request to search against.
public enum SearchScope: String, Sendable {
    case url
    case header
    case body
    case all
}

/// How the search value is interpreted.
public enum SearchMode: String, Sendable {
    case substring
    case wildcard
    case regex
}

/// A single parsed token from the search bar query string.
public struct SearchToken: Sendable, Equatable {
    public let scope: SearchScope
    public let mode: SearchMode
    public let value: String
    /// When true the token must NOT match for the request to pass.
    public let negate: Bool

    public init(scope: SearchScope, mode: SearchMode, value: String, negate: Bool) {
        self.scope = scope
        self.mode = mode
        self.value = value
        self.negate = negate
    }
}

// MARK: - Status DSL

/// Parse a status DSL string into an inclusive [lo, hi] range.
///
/// Supported forms:
///   "2xx" / "2XX"        → (200, 299)
///   "200..299"           → (200, 299)  inclusive
///   "200..<300"          → (200, 299)  exclusive upper
///   ">=400"              → (400, 599)
///   ">400"               → (401, 599)
///   "<=404"              → (100, 404)
///   "<500"               → (100, 499)
///   "404"                → (404, 404)
///
/// Returns nil for unrecognised input.
public func parseStatusDsl(_ dsl: String) -> (lo: Int, hi: Int)? {
    let s = dsl.trimmingCharacters(in: .whitespaces)
    guard !s.isEmpty else { return nil }

    // "NXX" class notation — 1xx/2xx/3xx/4xx/5xx (case-insensitive)
    let classPattern = try? NSRegularExpression(pattern: #"^([1-5])[xX]{2}$"#)
    if let match = classPattern?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
       let digitRange = Range(match.range(at: 1), in: s),
       let base = Int(s[digitRange]) {
        let lo = base * 100
        return (lo, lo + 99)
    }

    // "200..<300" exclusive upper
    let exclPattern = try? NSRegularExpression(pattern: #"^(\d{3})\.\.<(\d{3})$"#)
    if let match = exclPattern?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
       let r1 = Range(match.range(at: 1), in: s),
       let r2 = Range(match.range(at: 2), in: s),
       let lo = Int(s[r1]), let hiExcl = Int(s[r2]) {
        let hi = hiExcl - 1
        guard lo <= hi else { return nil }
        return (lo, hi)
    }

    // "200..299" inclusive range
    let inclPattern = try? NSRegularExpression(pattern: #"^(\d{3})\.\.(\d{3})$"#)
    if let match = inclPattern?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
       let r1 = Range(match.range(at: 1), in: s),
       let r2 = Range(match.range(at: 2), in: s),
       let lo = Int(s[r1]), let hi = Int(s[r2]) {
        guard lo <= hi else { return nil }
        return (lo, hi)
    }

    // ">=400" / ">400"
    let gePattern = try? NSRegularExpression(pattern: #"^(>=?)(\d{3})$"#)
    if let match = gePattern?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
       let opRange = Range(match.range(at: 1), in: s),
       let valRange = Range(match.range(at: 2), in: s),
       let val = Int(s[valRange]) {
        let inclusive = s[opRange] == ">="
        let lo = inclusive ? val : val + 1
        return (lo, 599)
    }

    // "<=404" / "<500"
    let lePattern = try? NSRegularExpression(pattern: #"^(<=?)(\d{3})$"#)
    if let match = lePattern?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
       let opRange = Range(match.range(at: 1), in: s),
       let valRange = Range(match.range(at: 2), in: s),
       let val = Int(s[valRange]) {
        let inclusive = s[opRange] == "<="
        let hi = inclusive ? val : val - 1
        return (100, hi)
    }

    // "404" exact single code
    let exactPattern = try? NSRegularExpression(pattern: #"^(\d{3})$"#)
    if let match = exactPattern?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)),
       let r1 = Range(match.range(at: 1), in: s),
       let code = Int(s[r1]) {
        return (code, code)
    }

    return nil
}

// MARK: - Search Token Parser

/// Scope prefix aliases → canonical SearchScope (lowercased key)
private let scopePrefixes: [(prefix: String, scope: SearchScope)] = [
    ("url:", .url),
    ("header:", .header),
    ("headers:", .header),
    ("body:", .body),
]

/// Detect the search mode from a raw value string (after prefix/negate stripping).
private func detectMode(_ raw: String) -> (mode: SearchMode, value: String) {
    // /regex/ notation
    if raw.hasPrefix("/") && raw.hasSuffix("/") && raw.count > 2 {
        let inner = String(raw.dropFirst().dropLast())
        return (.regex, inner)
    }
    // wildcard — contains * or ?
    if raw.contains("*") || raw.contains("?") {
        return (.wildcard, raw)
    }
    return (.substring, raw)
}

/// Tokenise a raw search bar string into structured SearchTokens.
///
/// Rules:
///   - Tokens are whitespace-separated.
///   - "quoted phrases" are kept as a single token.
///   - Scope prefix: `url:`, `header:` / `headers:`, `body:` before the value.
///   - Leading `-` → negate.
///   - `/pattern/` → regex mode.
///   - `*glob*` / `?` → wildcard mode.
///   - Everything else → substring.
///   - Empty or whitespace-only input → [].
public func parseSearchTokens(_ raw: String) -> [SearchToken] {
    var tokens: [SearchToken] = []
    guard !raw.trimmingCharacters(in: .whitespaces).isEmpty else { return tokens }

    let parts = splitRespectingQuotes(raw)

    for part in parts {
        guard !part.isEmpty else { continue }

        var rest = part
        var negate = false

        // Leading '-' means negate only when there is content after it.
        if rest.hasPrefix("-") && rest.count > 1 {
            negate = true
            rest = String(rest.dropFirst())
        }

        // A bare '-' or empty after stripping has no search meaning.
        if rest == "-" || rest.isEmpty { continue }

        // Detect scope prefix (case-insensitive)
        var scope: SearchScope = .all
        let restLower = rest.lowercased()
        for (prefix, s) in scopePrefixes {
            if restLower.hasPrefix(prefix) {
                scope = s
                rest = String(rest.dropFirst(prefix.count))
                break
            }
        }

        if rest.isEmpty { continue }

        let (mode, value) = detectMode(rest)
        if value.isEmpty { continue }

        tokens.append(SearchToken(scope: scope, mode: mode, value: value, negate: negate))
    }

    return tokens
}

/// Split a string on whitespace while keeping quoted substrings together.
/// Quotes are stripped from the result.
private func splitRespectingQuotes(_ input: String) -> [String] {
    var results: [String] = []
    var current = ""
    var inQuote = false
    var quoteChar: Character = "\""

    for ch in input {
        if inQuote {
            if ch == quoteChar {
                inQuote = false
            } else {
                current.append(ch)
            }
        } else if ch == "\"" || ch == "'" {
            inQuote = true
            quoteChar = ch
        } else if ch == " " || ch == "\t" {
            if !current.isEmpty {
                results.append(current)
                current = ""
            }
        } else {
            current.append(ch)
        }
    }

    if !current.isEmpty { results.append(current) }
    return results
}
