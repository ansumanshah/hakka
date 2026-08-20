import Foundation
import Testing

@testable import HakkaCommon

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
///
/// The suite also runs `--no-parallel` (see the justfile and ci.yml). Even with
/// every wait bounded, a test that parks a thread on purpose competes with the
/// other 70 suites for libdispatch's pool; on a 3-core runner that showed up as
/// unrelated concurrency tests observing zero of their 200 dispatched blocks.
/// Serialized the whole suite finishes in about a second, so there is no reason
/// to overlap it.
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

extension BreakpointEngine {
    /// Release every worker this engine may still park — including one that has
    /// not registered its pause yet.
    ///
    /// A single `resumeAll()` only frees what is registered at that instant, so
    /// it races a worker that is about to park: the worker registers a moment
    /// later, nothing ever resumes it, and it blocks a global-queue thread for
    /// the rest of the process. Enough of those and later tests' concurrent
    /// work never gets a thread to run on. Polling closes that window.
    func drainPausedWorkers(timeout: TimeInterval = 2) {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            resumeAll()
            Thread.sleep(forTimeInterval: 0.01)
        } while hasPaused() && Date() < deadline
        resumeAll()
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
