// @generated — do not edit. Synced from ios/Sources/Common/MockEngine.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

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

    // `internal` (module-default), not `private`: the matching logic lives in
    // `MockEngineMatching.swift` (kept separate to hold this file under 200
    // lines) and needs to reach these — still invisible outside the module.
    var rules: [MockRule] = []
    let lock = NSLock()
    private var idCounter = 0
    private var globalDelay: TimeInterval = 0
    /// `skipCount`/`stopAfter` bookkeeping, keyed by rule id — see
    /// `matchCountsById` in `MockEngine.ts` for the full rationale. In-memory
    /// only, reset on relaunch, and reset per-rule whenever that rule is
    /// (re-)added — see `addRule(_:id:)`/`removeRule(id:)`/`clearRules()`.
    var matchCountsById: [String: Int] = [:]

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
            modify: input.modify,
            failure: input.failure,
            skipCount: input.skipCount,
            stopAfter: input.stopAfter
        )
        rules.append(rule)
        // A (re-)add always restarts the skip/stop budget — this is a
        // new/edited rule as far as the engine is concerned.
        matchCountsById.removeValue(forKey: id)
        notifyLocked()
        return id
    }

    /// Remove a rule by its ID.
    public func removeRule(id: String) {
        lock.lock()
        defer { lock.unlock() }
        rules.removeAll { $0.id == id }
        matchCountsById.removeValue(forKey: id)
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
        matchCountsById.removeAll()
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
    //
    // `match(url:method:)`, the `skipCount`/`stopAfter` gate
    // (`admitMatchLocked`), and `regexOptions` live in
    // `MockEngineMatching.swift` — split out to keep this file under 200 lines.
}
