import Foundation

/// Ensures a `CheckedContinuation` is resumed exactly once no matter how
/// many completion paths race to resume it. Resuming a `CheckedContinuation`
/// twice is a fatal error in Swift Concurrency, and dropping it silently
/// hangs the caller forever — a script sandbox has more than one path that
/// wants to call "done" (the script returning control after
/// `evaluateScript`, and the watchdog aborting execution mid-script with
/// its own exception), so every completion in
/// `JavaScriptCoreScriptRuntime` funnels through this guard rather than
/// trusting the two paths to stay mutually exclusive by construction.
final class ScriptExecutionCompletionGuard: @unchecked Sendable {
    private let lock = NSLock()
    private var fired = false

    /// Returns `true` the first time it is called on a given instance,
    /// `false` on every call after. Callers must act on a completion only
    /// when this returns `true`.
    func tryFire() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if fired { return false }
        fired = true
        return true
    }
}
