import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

/// Pins the restart path for `RuleStore.subscribeChanges()` — ADR 0013's
/// per-subscription broadcast-stream pattern, applied here the same way it
/// was applied to `BridgeHub`. `RulesModel.observe()` is driven by the same
/// window-close-cancelled scene `.task` in `HakkaApp.swift` that
/// `TrafficModel.start()` is (see `TrafficModelRestartTests.swift`'s own
/// doc comment). Before this store moved off a stored single-consumer
/// `AsyncStream`, cancelling a task suspended in that stream's `next()` —
/// exactly what SwiftUI does to a scene's `.task` on window close — finished
/// the stream's storage for every consumer, present or future: a reopened
/// window's `RulesModel` would resubscribe to an already-finished stream and
/// silently mirror nothing, forever.
@Suite("RuleStore restart")
struct RuleStoreRestartTests {
    private func mockPayload(pattern: String = "/api/users") -> RuleEntry.Payload {
        .mock(MockRuleInput(pattern: pattern, response: MockResponse(status: 200, body: "[]")))
    }

    /// Subscribes, cancels a task mid-`next()`-await (simulating the window
    /// close), subscribes fresh, and proves a mutation made after the
    /// restart still reaches the new subscription. Verified to fail against
    /// a `subscribeChanges()` that hands back the same stored stream on
    /// every call, and pass against the fresh-stream-per-call
    /// implementation below.
    @Test(.timeLimit(.minutes(1)))
    func cancellingASubscriberMidAwaitDoesNotKillALaterSubscription() async throws {
        let store = RuleStore()

        let firstStream = await store.subscribeChanges()
        let consumer = Task {
            var iterator = firstStream.makeAsyncIterator()
            _ = await iterator.next() // suspends — nothing has been yielded yet
        }
        // Give the consumer a moment to actually reach the suspension point
        // inside `next()` before cancelling it out from under itself, the
        // same way SwiftUI cancels a scene's `.task` on window close.
        try await Task.sleep(for: .milliseconds(50))
        consumer.cancel()
        _ = await consumer.value

        // A fresh subscription made after the cancellation — a reopened
        // window's new `RulesModel.observe()` call — must still see
        // mutations that happen after it subscribes.
        var secondIterator = await store.subscribeChanges().makeAsyncIterator()
        try await store.add(mockPayload(), id: "rule-after-restart")

        let snapshot = await secondIterator.next()
        #expect(
            snapshot?.map(\.id) == ["rule-after-restart"],
            "a subscription created after an earlier one was cancelled mid-await must still receive new events"
        )
    }
}
