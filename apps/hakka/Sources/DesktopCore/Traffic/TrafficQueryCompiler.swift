import Foundation
import HakkaCommon

/// Compiles a `TrafficQuery` into a single predicate, mirroring
/// `compileQuery` in `packages/hakka-core/src/query/compile.ts`: patterns
/// are compiled once per query (here, once per call to `compile`), not once
/// per request, and every active filter is ANDed together.
///
/// Divergences from the TS grammar, driven by what a native capture actually
/// carries (`ios/Sources/Common/NetworkRequest.swift`):
/// - No `runtime` filter (client/server/edge is a Next.js rendering concept
///   with no equivalent on a URLSession/WebSocket capture).
/// - `host` is a filter here (substring match on the URL's host), not only a
///   `groupRequests` key as in the TS engine — this desktop tool has no
///   grouping UI yet, so host filtering is folded into the query instead.
/// - Header text joins ALL values per header name: Swift's headers are
///   `[String: [String]]` (multi-value, e.g. `Set-Cookie`); the TS model
///   is `Record<string, string>`.
public enum TrafficQueryCompiler {
    public static func compile(_ query: TrafficQuery) -> @Sendable (NetworkRequest) -> Bool {
        let tokens = query.tokens.map(CompiledToken.init)
        let statusRange = query.statusDsl.flatMap(TrafficStatusDsl.parse)
        let method = normalized(query.method)?.uppercased()
        let contentType = normalized(query.contentType)?.lowercased()
        let host = normalized(query.host)?.lowercased()
        let durationMin = query.durationMin
        let durationMax = query.durationMax
        let sizeMin = query.sizeMin
        let sizeMax = query.sizeMax

        return { request in
            for token in tokens {
                let matched = token.test(scopedText(request, scope: token.scope))
                if token.negate ? matched : !matched { return false }
            }

            if let statusRange {
                guard let status = request.status, statusRange.contains(status) else { return false }
            }
            if let method, request.method.rawValue.uppercased() != method { return false }
            if let contentType, !(request.contentType ?? "").lowercased().contains(contentType) { return false }
            if let host, !requestHost(request).lowercased().contains(host) { return false }

            if durationMin != nil || durationMax != nil {
                let duration = request.duration ?? 0
                if let durationMin, duration < durationMin { return false }
                if let durationMax, duration > durationMax { return false }
            }
            if sizeMin != nil || sizeMax != nil {
                let total = request.requestBodySize + request.responseBodySize
                if let sizeMin, total < sizeMin { return false }
                if let sizeMax, total > sizeMax { return false }
            }
            return true
        }
    }

    private static func normalized(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func requestHost(_ request: NetworkRequest) -> String {
        URLComponents(string: request.url)?.host ?? request.url
    }

    private static func scopedText(_ request: NetworkRequest, scope: TrafficSearchScope) -> String {
        switch scope {
        case .url: request.url
        case .header: headerText(request)
        case .body: bodyText(request)
        case .all: [request.url, headerText(request), bodyText(request)].joined(separator: "\n")
        }
    }

    private static func headerText(_ request: NetworkRequest) -> String {
        var parts: [String] = []
        for headers in [request.requestHeaders, request.responseHeaders] {
            for (name, values) in headers {
                parts.append(name)
                parts.append(contentsOf: values)
            }
        }
        return parts.joined(separator: "\n")
    }

    private static func bodyText(_ request: NetworkRequest) -> String {
        [request.requestBody ?? "", request.responseBody ?? ""].joined(separator: "\n")
    }
}

private struct CompiledToken {
    let scope: TrafficSearchScope
    let negate: Bool
    let test: @Sendable (String) -> Bool

    init(_ token: TrafficSearchToken) {
        scope = token.scope
        negate = token.negate
        switch token.mode {
        case .regex:
            test = Self.regexTest(pattern: token.value)
        case .wildcard:
            test = Self.regexTest(pattern: Self.globPattern(token.value))
        case .substring:
            let needle = token.value.lowercased()
            test = { text in text.lowercased().contains(needle) }
        }
    }

    /// An unparseable pattern never matches — mirrors the TS fallback (`/(?!)/`).
    /// `NSRegularExpression` rather than Swift's `Regex` type: the latter
    /// isn't `Sendable` on this SDK, and this closure must be.
    private static func regexTest(pattern: String) -> @Sendable (String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return { _ in false }
        }
        return { text in
            regex.firstMatch(in: text, range: NSRange(text.startIndex ..< text.endIndex, in: text)) != nil
        }
    }

    private static func globPattern(_ pattern: String) -> String {
        var result = ""
        for character in pattern {
            switch character {
            case "*": result += ".*"
            case "?": result += "."
            case ".", "+", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\":
                result += "\\\(character)"
            default: result.append(character)
            }
        }
        return result
    }
}
