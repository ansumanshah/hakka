import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

/// Pins the restart path for `PauseStore.subscribeChanges()` — ADR 0013's
/// per-subscription broadcast-stream pattern, mirroring
/// `RuleStoreRestartTests.swift` exactly (`PauseStore` mirrors `RuleStore`'s
/// shape on purpose, see `PauseStore.swift`'s own doc comment).
/// `PauseInboxModel.observe()` is driven by the same window-close-cancelled
/// scene `.task` in `HakkaApp.swift` as `RulesModel.observe()`. Before this
/// store moved off a stored single-consumer `AsyncStream`, cancelling a
/// task suspended in that stream's `next()` — exactly what SwiftUI does to
/// a scene's `.task` on window close — finished the stream's storage for
/// every consumer, present or future: a reopened window's `PauseInboxModel`
/// would resubscribe to an already-finished stream and silently mirror
/// nothing, forever, leaving a real device-side breakpoint pause with no
/// desktop watchdog to ever un-wedge it.
@Suite("PauseStore restart")
struct PauseStoreRestartTests {
    private func pause(id: String = "pause-1") -> PendingPause {
        PendingPause(
            pauseId: id,
            ruleId: "rule-1",
            phase: .request,
            device: "iphone-a",
            request: BreakpointPausedRequestSnapshot(url: "https://api.test/x", method: "GET", headers: [:]),
            response: nil
        )
    }

    /// Subscribes, cancels a task mid-`next()`-await (simulating the window
    /// close), subscribes fresh, and proves a mutation made after the
    /// restart still reaches the new subscription. Verified to fail against
    /// a `subscribeChanges()` that hands back the same stored stream on
    /// every call, and pass against the fresh-stream-per-call
    /// implementation below.
    @Test(.timeLimit(.minutes(1)))
    func cancellingASubscriberMidAwaitDoesNotKillALaterSubscription() async throws {
        let store = PauseStore()

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
        // window's new `PauseInboxModel.observe()` call — must still see
        // mutations that happen after it subscribes.
        var secondIterator = await store.subscribeChanges().makeAsyncIterator()
        await store.ingest(pause(id: "pause-after-restart"))

        let snapshot = await secondIterator.next()
        #expect(
            snapshot?.map(\.pauseId) == ["pause-after-restart"],
            "a subscription created after an earlier one was cancelled mid-await must still receive new events"
        )
    }
}
