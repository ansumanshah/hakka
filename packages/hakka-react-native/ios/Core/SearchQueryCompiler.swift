// @generated — do not edit. Synced from ios/Sources/Common/SearchQueryCompiler.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - Glob → Regex

/// Convert a glob pattern (star and question mark wildcards only) to an NSRegularExpression.
/// Case-insensitive. Returns a never-matching expression on failure (shouldn't happen for valid globs).
private func globToRegex(_ pattern: String) -> NSRegularExpression {
    // Escape all regex meta-chars except * and ?, then translate * → .* and ? → .
    var escaped = ""
    for ch in pattern {
        switch ch {
        case "*": escaped += ".*"
        case "?": escaped += "."
        case ".", "+", "^", "$", "{", "}", "(", ")", "[", "]", "|", "\\":
            escaped += "\\\(ch)"
        default:
            escaped.append(ch)
        }
    }
    return (try? NSRegularExpression(pattern: escaped, options: .caseInsensitive))
        ?? (try! NSRegularExpression(pattern: "(?!)", options: []))
}

// MARK: - Compiled Token

private struct CompiledToken {
    let scope: SearchScope
    let negate: Bool
    let test: (String) -> Bool
}

private func compileToken(_ token: SearchToken) -> CompiledToken {
    let testFn: (String) -> Bool

    switch token.mode {
    case .regex:
        let re = (try? NSRegularExpression(pattern: token.value, options: .caseInsensitive))
            ?? (try! NSRegularExpression(pattern: "(?!)", options: []))
        testFn = { text in
            re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
        }
    case .wildcard:
        let re = globToRegex(token.value)
        testFn = { text in
            re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
        }
    case .substring:
        let lower = token.value.lowercased()
        testFn = { text in text.lowercased().contains(lower) }
    }

    return CompiledToken(scope: token.scope, negate: token.negate, test: testFn)
}

// MARK: - Text Extraction per Scope

private func urlText(_ req: NetworkRequest) -> String {
    req.url
}

private func headerText(_ req: NetworkRequest) -> String {
    var parts: [String] = []
    for headers in [req.requestHeaders, req.responseHeaders] {
        for (key, values) in headers {
            parts.append(key)
            parts.append(contentsOf: values)
        }
    }
    return parts.joined(separator: "\n")
}

private func bodyText(_ req: NetworkRequest) -> String {
    [req.requestBody ?? "", req.responseBody ?? ""].joined(separator: "\n")
}

private func allText(_ req: NetworkRequest) -> String {
    [urlText(req), headerText(req), bodyText(req)].joined(separator: "\n")
}

private func scopedText(_ req: NetworkRequest, scope: SearchScope) -> String {
    switch scope {
    case .url:    return urlText(req)
    case .header: return headerText(req)
    case .body:   return bodyText(req)
    case .all:    return allText(req)
    }
}

// MARK: - Content-Type Helper

private func responseContentType(_ req: NetworkRequest) -> String {
    for (key, values) in req.responseHeaders {
        if key.lowercased() == "content-type" {
            return values.joined(separator: ", ").lowercased()
        }
    }
    return ""
}

// MARK: - SearchQuery

/// The fully-parsed query consumed by `compileSearchQuery`.
public struct SearchQuery: Sendable {
    /// Free-text tokens with scope/mode/negate semantics.
    public var tokens: [SearchToken]
    /// Status DSL string ("2xx", ">=400", "200..299", …).
    public var statusDsl: String?
    /// Exact HTTP method filter (case-insensitive).
    public var method: String?
    /// Substring match against the response content-type header.
    public var contentType: String?

    public init(
        tokens: [SearchToken] = [],
        statusDsl: String? = nil,
        method: String? = nil,
        contentType: String? = nil
    ) {
        self.tokens = tokens
        self.statusDsl = statusDsl
        self.method = method
        self.contentType = contentType
    }
}

// MARK: - Compile

/// Compile a SearchQuery into a predicate closure.
///
/// Regex/glob patterns are compiled exactly once here. The returned closure
/// can be called on many requests without re-compiling.
///
/// All active filters are ANDed together. An empty query matches everything.
public func compileSearchQuery(_ q: SearchQuery) -> (NetworkRequest) -> Bool {
    let compiled: [CompiledToken] = q.tokens.map(compileToken)

    let statusRange: (lo: Int, hi: Int)? = q.statusDsl.flatMap { parseStatusDsl($0) }

    let method: String? = q.method.flatMap {
        let t = $0.uppercased().trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? nil : t
    }

    let contentType: String? = q.contentType.flatMap {
        let t = $0.lowercased().trimmingCharacters(in: .whitespaces)
        return t.isEmpty ? nil : t
    }

    return { req in
        for token in compiled {
            let text = scopedText(req, scope: token.scope)
            let matched = token.test(text)
            if token.negate ? matched : !matched { return false }
        }

        if let (lo, hi) = statusRange {
            guard let status = req.status else { return false }
            if status < lo || status > hi { return false }
        }

        if let m = method {
            if req.method.rawValue.uppercased() != m { return false }
        }

        if let ct = contentType {
            if !responseContentType(req).contains(ct) { return false }
        }

        return true
    }
}
