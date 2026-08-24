import Foundation
import HakkaCommon

// MARK: - MockEngine data types
//
// `HakkaNetworkNoop` swaps in for `HakkaNetwork` in release builds (product
// selection in the app's xcconfig — see ios/README.md and
// docs/guides/production-safety.mdx). App code written against Debug's
// `MockRule`/`MockRuleInput`/`MockResponse` must still compile unchanged
// against Release, so these alias `HakkaCommon`'s definitions — the ones the
// real `HakkaNetwork.MockEngine` already uses — rather than re-declaring a
// parallel struct that can silently drift out of sync. They're pure data
// with no coupling to `MockEngine`'s matching logic, so there's nothing
// "noop" about the types themselves to stub out; only the engine below
// behaves differently.
public typealias MockResponse = HakkaCommon.MockResponse
public typealias MockRule = HakkaCommon.MockRule
public typealias MockRuleInput = HakkaCommon.MockRuleInput

// MARK: - MockEngine

/// No-op mock engine. All rule operations are discarded,
/// `match` always returns `nil`.
public final class MockEngine: @unchecked Sendable {
    /// Shared singleton.
    public static let shared = MockEngine()

    public init() {}

    // MARK: - Rule management

    /// No-op. Returns a placeholder ID.
    @discardableResult
    public func addRule(_ input: MockRuleInput) -> String {
        addRule(input, id: nil)
    }

    /// No-op. Returns the caller-provided ID when supplied.
    @discardableResult
    public func addRule(_ input: MockRuleInput, id providedId: String?) -> String {
        if let providedId, !providedId.isEmpty {
            return providedId
        }
        return "noop_0"
    }

    /// No-op.
    public func removeRule(id: String) {}

    /// No-op.
    public func enableRule(id: String) {}

    /// No-op.
    public func disableRule(id: String) {}

    /// Always empty.
    public func getRules() -> [MockRule] { [] }

    /// No-op.
    public func clearRules() {}

    /// No-op.
    public func setGlobalDelay(_ delay: TimeInterval) {}

    /// Always 0.
    public func getGlobalDelay() -> TimeInterval { 0 }

    // MARK: - Matching

    /// Always `nil`.
    public func match(url: String, method: String) -> MockRule? { nil }
}
