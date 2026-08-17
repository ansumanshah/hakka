import Foundation

// MARK: - MockRuleModify
//
// Swift mirror of `MockRuleModify` in `packages/hakka-core/src/engine/MockEngine.ts`
// — the source of truth; read it first. Declarative header/query/status/
// body-text edits, applied through `HakkaURLProtocol`'s passthrough-then-
// transform path (a real request is issued, then the outgoing request
// and/or the real response are rewritten). Plain data only — no functions —
// so it round-trips through the control-channel wire contract
// (`ControlCommand.swift`'s `mock.add`) exactly like the TS engine's
// `MockRuleModify` round-trips through `control.ts`.
//
// v1 scope, deliberately narrow (mirrors the TS engine exactly): header/query
// set-or-remove, a response status override, and plain-string (no regex) body
// find/replace.
public struct MockRuleModify: Sendable, Equatable {
    /// A single plain-string find/replace pair (see `replaceBody`).
    public struct BodyReplacement: Sendable, Equatable {
        public let find: String
        public let replace: String

        public init(find: String, replace: String) {
            self.find = find
            self.replace = replace
        }
    }

    /// Set/overwrite these headers on the outgoing request.
    public var setRequestHeaders: [String: String]?
    /// Remove these headers (case-insensitive) from the outgoing request.
    public var removeRequestHeaders: [String]?
    /// Set/overwrite these query-string parameters on the outgoing request URL.
    public var setQueryParams: [String: String]?
    /// Remove these query-string parameters from the outgoing request URL.
    public var removeQueryParams: [String]?
    /// Override the real response's status code.
    public var status: Int?
    /// Set/overwrite these headers on the real response.
    public var setResponseHeaders: [String: String]?
    /// Remove these headers (case-insensitive) from the real response.
    public var removeResponseHeaders: [String]?
    /// Plain-string find/replace pairs applied to the response body, in order.
    public var replaceBody: [BodyReplacement]?

    public init(
        setRequestHeaders: [String: String]? = nil,
        removeRequestHeaders: [String]? = nil,
        setQueryParams: [String: String]? = nil,
        removeQueryParams: [String]? = nil,
        status: Int? = nil,
        setResponseHeaders: [String: String]? = nil,
        removeResponseHeaders: [String]? = nil,
        replaceBody: [BodyReplacement]? = nil
    ) {
        self.setRequestHeaders = setRequestHeaders
        self.removeRequestHeaders = removeRequestHeaders
        self.setQueryParams = setQueryParams
        self.removeQueryParams = removeQueryParams
        self.status = status
        self.setResponseHeaders = setResponseHeaders
        self.removeResponseHeaders = removeResponseHeaders
        self.replaceBody = replaceBody
    }
}

// MARK: - MockRuleTransform
//
// Pure declarative-edit application — mirrors `MockEngine.ts`'s
// `applyHeaderEdits` / `applyQueryEdits` / `applyBodyReplacements` exactly:
// case-insensitive header removal, exact-key header set, plain-string body
// find/replace applied in order (empty `find` skipped — it would otherwise be
// a pathological no-op). No side effects, no I/O — used by
// `HakkaURLProtocol`'s passthrough-then-transform path.
public enum MockRuleTransform {

    /// Set/remove edits for a plain header map. Case-insensitive removal; exact-key set.
    public static func applyHeaderEdits(
        headers: [String: String],
        set: [String: String]?,
        remove: [String]?
    ) -> [String: String] {
        guard set != nil || remove != nil else { return headers }
        var next = headers
        if let remove, !remove.isEmpty {
            let removeLower = Set(remove.map { $0.lowercased() })
            for key in next.keys where removeLower.contains(key.lowercased()) {
                next.removeValue(forKey: key)
            }
        }
        if let set {
            for (key, value) in set { next[key] = value }
        }
        return next
    }

    /// Set/remove edits for a URL's query string. Falls back to returning the
    /// URL unchanged if it cannot be parsed as `URLComponents` (fail-open,
    /// mirrors `MockEngine.ts`'s try/catch fallback).
    public static func applyQueryEdits(
        url: String,
        set: [String: String]?,
        remove: [String]?
    ) -> String {
        guard set != nil || remove != nil else { return url }
        guard var components = URLComponents(string: url) else { return url }

        var items = components.queryItems ?? []
        if let remove, !remove.isEmpty {
            let removeSet = Set(remove)
            items.removeAll { removeSet.contains($0.name) }
        }
        if let set {
            for (key, value) in set {
                // Mirrors `URLSearchParams.set`: update the first occurrence in
                // place, drop any further duplicates, append if absent.
                var replaced = false
                items = items.compactMap { item in
                    guard item.name == key else { return item }
                    if replaced { return nil }
                    replaced = true
                    return URLQueryItem(name: key, value: value)
                }
                if !replaced { items.append(URLQueryItem(name: key, value: value)) }
            }
        }
        components.queryItems = items.isEmpty ? nil : items
        return components.string ?? url
    }

    /// Plain-string (no regex) find/replace, applied in order. Empty `find` is
    /// skipped (would loop pathologically / be a meaningless no-op).
    public static func applyBodyReplacements(
        body: String,
        replacements: [MockRuleModify.BodyReplacement]?
    ) -> String {
        guard let replacements, !replacements.isEmpty else { return body }
        var next = body
        for replacement in replacements where !replacement.find.isEmpty {
            next = next.replacingOccurrences(of: replacement.find, with: replacement.replace)
        }
        return next
    }
}
