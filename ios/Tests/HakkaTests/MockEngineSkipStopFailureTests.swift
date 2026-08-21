import Foundation
import Testing
@testable import HakkaNetwork
import HakkaCommon

// MARK: - MockEngine — skipCount/stopAfter/failure
//
// Split out of MockEngineTests.swift to keep files under 200 lines.

@Suite("MockEngine — skipCount/stopAfter/failure", .serialized)
struct MockEngineSkipStopFailureTests {

    private func freshEngine() -> MockEngine {
        MockEngine()
    }

    // MARK: - Defaults

    @Test func defaultsHaveNoFailureAndZeroSkipUnlimitedStop() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse()))
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule?.failure == nil)
        #expect(rule?.skipCount == 0)
        #expect(rule?.stopAfter == nil)
    }

    // MARK: - skipCount

    @Test func skipCountZeroAppliesImmediately() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(body: "M"), skipCount: 0))
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule != nil)
    }

    @Test func skipCountNSkipsFirstNMatchesThenApplies() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(body: "M"), skipCount: 2))
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // match 1: skipped
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // match 2: skipped
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil) // match 3: applies
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil) // match 4: still applies
    }

    @Test func skippedMatchesDoNotIncrementHitCount() {
        let engine = freshEngine()
        let id = engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: 1))
        _ = engine.match(url: "https://example.com/api", method: "GET") // skipped
        _ = engine.match(url: "https://example.com/api", method: "GET") // applied
        let rule = engine.getRules().first { $0.id == id }
        #expect(rule?.hitCount == 1)
    }

    // MARK: - stopAfter

    @Test func stopAfterNAppliesFirstNThenStopsForever() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(body: "M"), stopAfter: 2))
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil) // applied 1
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil) // applied 2
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // exhausted
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // stays exhausted
    }

    @Test func stopAfterZeroWithNoSkipNeverApplies() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), stopAfter: 0))
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil)
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil)
    }

    @Test func stopAfterNilIsUnlimited() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), stopAfter: nil))
        for _ in 0..<25 {
            #expect(engine.match(url: "https://example.com/api", method: "GET") != nil)
        }
    }

    // MARK: - skipCount + stopAfter interaction

    @Test func skipThenStopBoundary() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: 1, stopAfter: 2))
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // match 1: skipped
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil) // match 2: applied #1
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil) // match 3: applied #2
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // match 4: exhausted
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // match 5: still exhausted
    }

    // MARK: - Budget resets on re-add

    @Test func reAddingRuleWithSameIdResetsBudget() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: 1), id: "r1")
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // consumed the skip

        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: 1), id: "r1")
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // budget restarted
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil)
    }

    @Test func removingAndReAddingSameIdStartsFreshBudget() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: 1), id: "r1")
        _ = engine.match(url: "https://example.com/api", method: "GET")
        engine.removeRule(id: "r1")
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: 1), id: "r1")
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil)
    }

    // MARK: - failure

    @Test func failureIsCarriedThroughAndMarksAction() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(),
            failure: MockFailure(code: .timeout)
        ))
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule?.failure?.code == .timeout)
    }

    @Test func failureUrlErrorCodeMapping() {
        #expect(MockFailureCode.timeout.urlErrorCode == NSURLErrorTimedOut)
        #expect(MockFailureCode.noConnection.urlErrorCode == NSURLErrorNotConnectedToInternet)
        #expect(MockFailureCode.cannotFindHost.urlErrorCode == NSURLErrorCannotFindHost)
        #expect(MockFailureCode.cannotConnectToHost.urlErrorCode == NSURLErrorCannotConnectToHost)
        #expect(MockFailureCode.connectionLost.urlErrorCode == NSURLErrorNetworkConnectionLost)
        #expect(MockFailureCode.secureConnectionFailed.urlErrorCode == NSURLErrorSecureConnectionFailed)
        #expect(MockFailureCode.cancelled.urlErrorCode == NSURLErrorCancelled)
        #expect(MockFailureCode.unknown.urlErrorCode == NSURLErrorUnknown)
    }

    @Test func failureHonorsSkipCount() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(
            pattern: "/api",
            response: MockResponse(),
            failure: MockFailure(code: .cannotFindHost),
            skipCount: 1
        ))
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil) // skipped
        let rule = engine.match(url: "https://example.com/api", method: "GET")
        #expect(rule?.failure?.code == .cannotFindHost)
    }

    // MARK: - Hostile input at the engine level (negative/absurd values clamp, never crash)

    @Test func negativeSkipCountClampsToZero() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: -5))
        // Clamped to 0 — applies immediately, does not crash or skip "negative" matches.
        #expect(engine.match(url: "https://example.com/api", method: "GET") != nil)
    }

    @Test func negativeStopAfterClampsToZero() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), stopAfter: -5))
        // Clamped to 0 — never applies, does not crash.
        #expect(engine.match(url: "https://example.com/api", method: "GET") == nil)
    }

    @Test func absurdlyLargeSkipCountNeverAppliesWithinReasonableWindow() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), skipCount: Int.max))
        for _ in 0..<50 {
            #expect(engine.match(url: "https://example.com/api", method: "GET") == nil)
        }
    }

    @Test func absurdlyLargeStopAfterBehavesAsUnlimitedWithinReasonableWindow() {
        let engine = freshEngine()
        engine.addRule(MockRuleInput(pattern: "/api", response: MockResponse(), stopAfter: Int.max))
        for _ in 0..<50 {
            #expect(engine.match(url: "https://example.com/api", method: "GET") != nil)
        }
    }
}
