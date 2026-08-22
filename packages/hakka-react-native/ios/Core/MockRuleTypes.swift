// @generated — do not edit. Synced from ios/Sources/Common/MockRuleTypes.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - MockResponse
//
// Split out of `MockEngine.swift` to keep files under 200 lines: the plain
// data types (`MockResponse`/`MockRule`/`MockRuleInput`) live here, the
// `MockEngine` class itself stays in `MockEngine.swift`.

/// Response to return when a mock rule matches.
public struct MockResponse: Sendable {
    /// HTTP status code. Default: 200.
    public let status: Int
    /// Response headers — one representative value per name. Kept for
    /// backward compatibility; see `headerValues` for names that carry more
    /// than one value.
    public let headers: [String: String]
    /// Additive, backward-compatible widening of `headers` for header names
    /// that carry more than one value on the wire — chiefly `Set-Cookie`,
    /// where RFC 6265 §3 forbids folding multiple values into one
    /// comma-joined field (a cookie's own `Expires` attribute can legally
    /// contain a comma, so a naive join is ambiguous/corrupt). Mirrors
    /// `MockResponse.headerValues` in `packages/hakka-core/src/engine/MockEngine.ts`
    /// exactly — only header names with 2+ values need an entry here; every
    /// name (including these) still has a representative value in `headers`
    /// so an old consumer that only reads `headers` keeps working unchanged.
    public let headerValues: [String: [String]]
    /// Response body as a string, or `nil` for an empty body.
    public let body: String?
    /// Artificial delay in seconds before responding. 0 = instant.
    public let delay: TimeInterval

    public init(
        status: Int = 200,
        headers: [String: String] = [:],
        headerValues: [String: [String]] = [:],
        body: String? = nil,
        delay: TimeInterval = 0
    ) {
        self.status = status
        self.headers = headers
        self.headerValues = headerValues
        self.body = body
        self.delay = delay
    }

    /// The header fields to hand `HTTPURLResponse(headerFields:)`, the
    /// engine's one available apply mechanism: Foundation's public
    /// initializer takes `[String: String]` — there is no supported way to
    /// attach two distinct values under one header name (confirmed against
    /// Apple's own `HTTPURLResponse`/`URLSession` stack — see
    /// developer.apple.com/forums/thread/671450 — only the last value of a
    /// same-name header survives `allHeaderFields`). For a name in
    /// `headerValues`, this joins its values with `", "` rather than using
    /// `headers`' single representative value: for `Set-Cookie` specifically
    /// that join is NOT a naive/lossy fold — `HTTPCookie.cookies
    /// (withResponseHeaderFields:for:)`, the API `URLSession` itself uses to
    /// populate the cookie jar, correctly splits it back into distinct
    /// cookies even when one has a comma inside its `Expires` attribute
    /// (verified empirically: `HTTPCookie.cookies(withResponseHeaderFields:
    /// ["Set-Cookie": "a=1; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/,
    /// b=2; Path=/"], for:)` returns two cookies, not one mangled cookie).
    public var httpHeaderFields: [String: String] {
        guard !headerValues.isEmpty else { return headers }
        var fields = headers
        for (name, values) in headerValues where !values.isEmpty {
            fields[name] = values.joined(separator: ", ")
        }
        return fields
    }
}

// MARK: - MockRule

/// Rule matching incoming requests. Returned by `MockEngine.getRules()`.
public struct MockRule: Sendable, Identifiable {
    /// Unique identifier assigned by `MockEngine.addRule(_:)`.
    public let id: String
    /// URL substring or regex pattern to match against.
    public let pattern: String
    /// When `true`, `pattern` is treated as a regular expression.
    public let isRegex: Bool
    /// HTTP method filter. `nil` matches all methods.
    public let method: String?
    /// Response to return when this rule matches.
    public let response: MockResponse
    /// Whether the rule is active.
    public var enabled: Bool
    /// Number of times this rule has been matched.
    public var hitCount: Int
    /// Regular expression flags passed from JS mock rules.
    public let regexFlags: String?
    /// Map Remote: send the real request to a different URL instead of `response`.
    /// Applied on the passthrough-then-transform path (see `HakkaURLProtocol`) —
    /// mirrors `MockRule.redirectTo` in `packages/hakka-core/src/engine/MockEngine.ts`.
    public let redirectTo: String?
    /// Abort the matched request with a network-error-shaped failure before it
    /// is sent. Takes priority over `redirectTo`/`modify` when `true`, but
    /// `failure` (if present) takes priority over `block`. Mirrors
    /// `MockRule.block` in `MockEngine.ts`.
    public let block: Bool
    /// Declarative header/query/status/body edits (see `MockRuleModify`).
    /// Like `redirectTo`, this alone routes the match through the
    /// passthrough-then-transform path — no separate "rewrite mode" flag needed.
    public let modify: MockRuleModify?
    /// Simulate a specific transport-level failure instead of serving
    /// `response` (see `MockFailure`). Takes priority over `block`.
    public let failure: MockFailure?
    /// Serve the real response for this many initial matches before this
    /// rule starts applying. See `MockEngine.admitMatch(_:)` and
    /// `MockRule.skipCount` in `MockEngine.ts` for the full semantics —
    /// the counter is in-memory engine state, reset on process relaunch.
    public let skipCount: Int
    /// After the rule has applied this many times (post-`skipCount`), stop
    /// applying it forever. `nil`: unlimited. Mirrors `MockRule.stopAfter`.
    public let stopAfter: Int?

    /// True when this rule is served via the passthrough-then-transform path
    /// (issue the real request, then rewrite outgoing URL/headers/query and/or
    /// transform incoming status/headers/body) rather than served wholesale
    /// from `response`. Mirrors `MockEngine.ts`'s `isRewrite(rule)` — native mock
    /// rules carry no `rewriteRequest`/`rewriteResponse` functions (those cannot
    /// cross a native bridge), so a rule is a "rewrite" here purely because it
    /// declares `redirectTo` and/or `modify`.
    public var isRewrite: Bool { redirectTo != nil || modify != nil }
}

// MARK: - MockRuleInput

/// Input for adding a new rule (without id/hitCount).
public struct MockRuleInput: Sendable {
    public let pattern: String
    public let isRegex: Bool
    public let method: String?
    public let response: MockResponse
    public let enabled: Bool
    public let regexFlags: String?
    public let redirectTo: String?
    public let block: Bool
    public let modify: MockRuleModify?
    public let failure: MockFailure?
    public let skipCount: Int
    public let stopAfter: Int?

    public init(
        pattern: String,
        isRegex: Bool = false,
        method: String? = nil,
        response: MockResponse,
        enabled: Bool = true,
        redirectTo: String? = nil,
        block: Bool = false,
        modify: MockRuleModify? = nil,
        failure: MockFailure? = nil,
        skipCount: Int = 0,
        stopAfter: Int? = nil
    ) {
        self.init(
            pattern: pattern,
            isRegex: isRegex,
            regexFlags: nil,
            method: method,
            response: response,
            enabled: enabled,
            redirectTo: redirectTo,
            block: block,
            modify: modify,
            failure: failure,
            skipCount: skipCount,
            stopAfter: stopAfter
        )
    }

    public init(
        pattern: String,
        isRegex: Bool = false,
        regexFlags: String?,
        method: String? = nil,
        response: MockResponse,
        enabled: Bool = true,
        redirectTo: String? = nil,
        block: Bool = false,
        modify: MockRuleModify? = nil,
        failure: MockFailure? = nil,
        skipCount: Int = 0,
        stopAfter: Int? = nil
    ) {
        self.pattern = pattern
        self.isRegex = isRegex
        self.regexFlags = regexFlags
        self.method = method
        self.response = response
        self.enabled = enabled
        self.redirectTo = redirectTo
        self.block = block
        self.modify = modify
        self.failure = failure
        self.skipCount = skipCount
        self.stopAfter = stopAfter
    }
}
