import JavaScriptCore

/// `JSContextGroupSetExecutionTimeLimit` / `...ClearExecutionTimeLimit` are
/// WebKit's own mechanism for stopping a runaway script — the same one
/// behind Safari's "a script on this page is busy" prompt. They are not
/// declared in JavaScriptCore's public umbrella header, but the symbols are
/// present and callable in the system framework shipped with this
/// toolchain (verified by hand at development time: a `while (true) {}`
/// script armed with a 0.3s limit measurably returns in ~0.3s instead of
/// hanging). This is the only mechanism that stops execution from *inside*
/// the interpreter's own bytecode dispatch loop, which is what makes the
/// stop real rather than cooperative. The alternative — killing the OS
/// thread the context runs on from the outside — cannot safely reclaim a
/// virtual machine mid-instruction and was rejected for that reason.
///
/// `JavaScriptCoreScriptRuntime` is the only caller; nothing else in this
/// module should reach for these directly.
@_silgen_name("JSContextGroupSetExecutionTimeLimit")
private func jsContextGroupSetExecutionTimeLimit(
    _ group: JSContextGroupRef,
    _ limit: Double,
    _ callback: (@convention(c) (JSContextRef?, UnsafeMutableRawPointer?) -> Bool)?,
    _ context: UnsafeMutableRawPointer?
) -> Void

@_silgen_name("JSContextGroupClearExecutionTimeLimit")
private func jsContextGroupClearExecutionTimeLimit(_ group: JSContextGroupRef) -> Void

enum ScriptExecutionWatchdog {
    /// The exact message JavaScriptCore's watchdog reports through
    /// `JSContext.exception` when it aborts a script for running past its
    /// time limit. `JavaScriptCoreScriptRuntime` matches on this to tell a
    /// stopped script apart from one that threw its own error.
    static let terminationMessage = "JavaScript execution terminated."

    /// Arms `context`'s virtual-machine group to abort with an exception
    /// once `timeout` elapses. Every call in this runtime creates its own
    /// `JSContext` (and, transitively, its own group), so this never arms a
    /// limit another script's context could observe.
    static func arm(_ context: JSContext, timeout: TimeInterval) {
        guard let group = JSContextGetGroup(context.jsGlobalContextRef) else { return }
        jsContextGroupSetExecutionTimeLimit(group, timeout, { _, _ in true }, nil)
    }

    /// Disarms the limit once the script has returned, win or lose, so a
    /// group that somehow outlived this one call — not the case for a
    /// per-script context, but future callers must not assume otherwise —
    /// never carries a stale limit into unrelated work.
    static func disarm(_ context: JSContext) {
        guard let group = JSContextGetGroup(context.jsGlobalContextRef) else { return }
        jsContextGroupClearExecutionTimeLimit(group)
    }
}
