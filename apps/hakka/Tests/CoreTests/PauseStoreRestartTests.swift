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
        // A fixed sleep here used to stand in for "the consumer task has
        // actually been scheduled and reached the suspension point inside
        // `next()`" — a guess about scheduling latency that a busy machine
        // can blow through, silently degrading this to a false pass (the
        // consumer never even started before `cancel()` fired). `readyGate`
        // makes that a fact instead of a guess: `fire()` is synchronous, so
        // by the time `wait()` returns, the consumer has demonstrably run up
        // to (and is about to enter) the exact suspending call being cancelled.
        let readyGate = ReadyGate()
        let consumer = Task {
            var iterator = firstStream.makeAsyncIterator()
            readyGate.fire()
            _ = await iterator.next() // suspends — nothing has been yielded yet
        }
        await readyGate.wait()
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

/// A one-shot, thread-safe ready signal: `fire()` is a plain synchronous
/// call, not `async` — an actor hop here would reintroduce a scheduling gap
/// of its own between "signalled" and the consumer's next statement
/// actually running, defeating the point of replacing `Task.sleep`.
private final class ReadyGate: @unchecked Sendable {
    private let lock = NSLock()
    private var isFired = false
    private var continuation: CheckedContinuation<Void, Never>?

    func fire() {
        lock.lock()
        isFired = true
        let pending = continuation
        continuation = nil
        lock.unlock()
        // Resumed after unlocking — `withCheckedContinuation`'s resume runs
        // its waiter synchronously on some thread, and that waiter's very
        // next line (`wait()` returning) must never re-enter this lock while
        // this call still held it.
        pending?.resume()
    }

    func wait() async {
        await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
            lock.lock()
            defer { lock.unlock() }
            if isFired {
                k.resume()
            } else {
                continuation = k
            }
        }
    }
}
