import Foundation
import Testing

/// Bounded waits for the tests that drive `BreakpointEngine`'s blocking API.
///
/// Those tests park a background worker inside `pauseRequest`/`pauseResponse`
/// and resume it from the test thread. Two habits made that hang CI for six
/// hours per run (the job timeout) while passing locally in under a second:
///
/// - `Thread.sleep(0.05)` to "give the background thread time to block". On a
///   contended runner the worker may not have started at all, so the pause is
///   not registered yet and the test resumes nothing.
/// - `semaphore.wait()` with no timeout, which turns any such miss into an
///   unbounded block instead of a failure.
///
/// Worse, each missed test leaves a worker parked forever on its semaphore.
/// Enough of those exhaust the global queue's thread pool, and a later test's
/// wait never gets a worker to signal it — the actual six-hour hang.
///
/// `waitUntil` replaces the sleep with a bounded poll on the real condition,
/// and `expectSignal` makes a missed signal a fast, named failure.
enum BlockingTestSupport {
    /// Poll `condition` until it holds or the deadline passes. Returns whether
    /// it held, so callers can fail with their own message.
    static func waitUntil(timeout: TimeInterval = 5, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            Thread.sleep(forTimeInterval: 0.005)
        }
        return condition()
    }
}

extension DispatchSemaphore {
    /// Wait with a bound, recording a failure rather than blocking forever.
    func expectSignal(
        within seconds: TimeInterval = 5,
        _ what: String,
        sourceLocation: SourceLocation = #_sourceLocation,
    ) {
        if wait(timeout: .now() + seconds) == .timedOut {
            Issue.record("timed out waiting for \(what)", sourceLocation: sourceLocation)
        }
    }
}
