import Foundation

// MARK: - MockResponse

/// Response to return when a mock rule matches.
public struct MockResponse: Sendable {
    /// HTTP status code. Default: 200.
    public let status: Int
    /// Response headers.
    public let headers: [String: String]
    /// Response body as a string, or `nil` for an empty body.
    public let body: String?
    /// Artificial delay in seconds before responding. 0 = instant.
    public let delay: TimeInterval

    public init(
        status: Int = 200,
        headers: [String: String] = [:],
        body: String? = nil,
        delay: TimeInterval = 0
    ) {
        self.status = status
        self.headers = headers
        self.body = body
        self.delay = delay
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
    /// is sent. Takes priority over `redirectTo`/`modify` when `true`. Mirrors
    /// `MockRule.block` in `MockEngine.ts`.
    public let block: Bool
    /// Declarative header/query/status/body edits (see `MockRuleModify`).
    /// Like `redirectTo`, this alone routes the match through the
    /// passthrough-then-transform path — no separate "rewrite mode" flag needed.
    public let modify: MockRuleModify?

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

    public init(
        pattern: String,
        isRegex: Bool = false,
        method: String? = nil,
        response: MockResponse,
        enabled: Bool = true,
        redirectTo: String? = nil,
        block: Bool = false,
        modify: MockRuleModify? = nil
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
            modify: modify
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
        modify: MockRuleModify? = nil
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
    }
}

// MARK: - MockEngine

/// Thread-safe mock engine for intercepting network requests and returning
/// canned responses. Used by `HakkaURLProtocol` to short-circuit requests
/// before they hit the network.
///
/// Usage:
/// ```swift
/// let id = MockEngine.shared.addRule(MockRuleInput(
///     pattern: "/api/users",
///     response: MockResponse(status: 200, body: "{\"users\":[]}")
/// ))
/// // Later: MockEngine.shared.removeRule(id: id)
/// ```
public final class MockEngine: @unchecked Sendable {
    /// Shared singleton used by `HakkaURLProtocol`.
    public static let shared = MockEngine()

    private var rules: [MockRule] = []
    private let lock = NSLock()
    private var idCounter = 0
    private var globalDelay: TimeInterval = 0

    // Change listeners (UI subscribers) keyed by a UUID token for safe removal —
    // same shape as `BreakpointEngine`/`ThrottleEngine` so `MocksView` follows
    // the identical subscribe/refresh pattern as `BreakpointsView`/`ThrottleView`.
    private var listeners: [String: () -> Void] = [:]

    public init() {}

    // MARK: - Rule management

    /// Add a mock rule. Returns the generated rule ID.
    @discardableResult
    public func addRule(_ input: MockRuleInput) -> String {
        addRule(input, id: nil)
    }

    /// Add or replace a mock rule using a caller-provided ID.
    @discardableResult
    public func addRule(_ input: MockRuleInput, id providedId: String?) -> String {
        lock.lock()
        defer { lock.unlock() }

        let id: String
        if let providedId, !providedId.isEmpty {
            id = providedId
            rules.removeAll { $0.id == providedId }
        } else {
            idCounter += 1
            id = "mock_\(idCounter)_\(Int(Date().timeIntervalSince1970 * 1000))"
        }

        let rule = MockRule(
            id: id,
            pattern: input.pattern,
            isRegex: input.isRegex,
            method: input.method,
            response: input.response,
            enabled: input.enabled,
            hitCount: 0,
            regexFlags: input.regexFlags,
            redirectTo: input.redirectTo,
            block: input.block,
            modify: input.modify
        )
        rules.append(rule)
        notifyLocked()
        return id
    }

    /// Remove a rule by its ID.
    public func removeRule(id: String) {
        lock.lock()
        defer { lock.unlock() }
        rules.removeAll { $0.id == id }
        notifyLocked()
    }

    /// Enable a rule by its ID.
    public func enableRule(id: String) {
        lock.lock()
        defer { lock.unlock() }
        if let idx = rules.firstIndex(where: { $0.id == id }) {
            rules[idx].enabled = true
        }
        notifyLocked()
    }

    /// Disable a rule by its ID.
    public func disableRule(id: String) {
        lock.lock()
        defer { lock.unlock() }
        if let idx = rules.firstIndex(where: { $0.id == id }) {
            rules[idx].enabled = false
        }
        notifyLocked()
    }

    /// Returns a snapshot of all rules.
    public func getRules() -> [MockRule] {
        lock.lock()
        defer { lock.unlock() }
        return rules
    }

    /// Remove all rules.
    public func clearRules() {
        lock.lock()
        defer { lock.unlock() }
        rules.removeAll()
        idCounter = 0
        globalDelay = 0
        notifyLocked()
    }

    /// Set the global delay (in seconds) that applies to all matched mock responses.
    public func setGlobalDelay(_ delay: TimeInterval) {
        lock.lock()
        defer { lock.unlock() }
        globalDelay = max(0, delay)
        notifyLocked()
    }

    /// Return the configured global delay in seconds.
    public func getGlobalDelay() -> TimeInterval {
        lock.lock()
        defer { lock.unlock() }
        return globalDelay
    }

    // MARK: - Observation

    /// Subscribe to rule changes (add/remove/enable/disable/clear/global delay).
    /// Returns an unsubscribe closure. Mirrors `BreakpointEngine.subscribe(_:)` /
    /// `ThrottleEngine.subscribe(_:)` — `MocksView` refreshes the same way
    /// `BreakpointsView`/`ThrottleView` do.
    @discardableResult
    public func subscribe(_ listener: @escaping () -> Void) -> () -> Void {
        lock.lock()
        let token = UUID().uuidString
        listeners[token] = listener
        lock.unlock()
        return { [weak self] in
            self?.lock.lock()
            self?.listeners.removeValue(forKey: token)
            self?.lock.unlock()
        }
    }

    // Called with lock held; dispatches to listeners on the main queue after unlocking.
    private func notifyLocked() {
        let snapshot = Array(listeners.values)
        DispatchQueue.main.async {
            for l in snapshot { l() }
        }
    }

    // MARK: - Matching

    /// Called by `HakkaURLProtocol.startLoading()` before making the real
    /// network request. Returns the first matching enabled rule, or `nil`.
    /// Increments `hitCount` on the matched rule.
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

            rules[i].hitCount += 1
            return rules[i]
        }
        return nil
    }

    private func regexOptions(_ flags: String?) -> NSRegularExpression.Options {
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
