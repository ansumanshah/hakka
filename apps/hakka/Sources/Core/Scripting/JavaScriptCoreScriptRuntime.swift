import Foundation
import JavaScriptCore

/// The JavaScriptCore-backed `ScriptRuntime`.
///
/// Concurrency shape: every call to `run` gets its own `JSContext` — and,
/// since the `JSContext()` convenience initializer allocates its own
/// `JSVirtualMachine` unless told otherwise, its own virtual-machine group —
/// created, used, and torn down entirely inside one `DispatchQueue.async`
/// closure on a queue made fresh for that call. `JSContext` is not
/// `Sendable`; it never crosses a thread or task boundary as a value here,
/// so Swift 6 strict concurrency has nothing to check and nothing to
/// object to. This is "one `JSContext` per script on its own serial queue":
/// the queue provides the thread JSC needs to run on, and its exclusivity
/// to this one call is what makes "a script cannot see another script's
/// state" true without any extra bookkeeping.
///
/// Two independent paths can report this call finished — the script
/// returning control normally, and the watchdog aborting execution with its
/// own exception (still delivered through the *same* synchronous
/// `evaluateScript` return, but conceptually distinct) — so the actual
/// resume is guarded by `ScriptExecutionCompletionGuard` rather than
/// trusted to happen exactly once by construction.
public final class JavaScriptCoreScriptRuntime: ScriptRuntime {
    public init() {}

    public func run(_ input: ScriptInput) async throws -> ScriptOutput {
        let queue = DispatchQueue(label: "hakka.script-runtime", target: .global(qos: .userInitiated))
        let completion = ScriptExecutionCompletionGuard()
        return try await withCheckedThrowingContinuation { continuation in
            queue.async {
                let result = Self.execute(input)
                guard completion.tryFire() else { return }
                switch result {
                case .success(let output):
                    continuation.resume(returning: output)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    /// Runs synchronously on the caller's (dedicated) queue. Building the
    /// context, installing the bridge, evaluating, and reading the result
    /// back all happen here so the `JSContext` never needs to escape this
    /// one stack frame.
    private static func execute(_ input: ScriptInput) -> Result<ScriptOutput, ScriptError> {
        guard let context = JSContext() else {
            return .failure(.runtimeError("failed to create a JavaScriptCore context"))
        }

        let logs = ScriptLogSink()
        ScriptBridge.install(input: input, logs: logs, into: context)

        ScriptExecutionWatchdog.arm(context, timeout: input.timeout)
        context.evaluateScript(input.source)
        ScriptExecutionWatchdog.disarm(context)

        if let exception = context.exception {
            if exception.toString() == ScriptExecutionWatchdog.terminationMessage {
                return .failure(.timeout)
            }
            return .failure(.runtimeError(exception.toString() ?? "unknown script error"))
        }

        let output = ScriptOutput(
            request: input.request != nil ? ScriptBridge.readRequest(from: context) : nil,
            response: input.response != nil ? ScriptBridge.readResponse(from: context) : nil,
            logs: logs.lines
        )
        return .success(output)
    }
}
