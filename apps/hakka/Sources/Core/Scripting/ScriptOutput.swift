import Foundation

/// What a script produced: its (possibly mutated) request/response, and
/// anything it logged. Only present when the input carried the matching
/// context — a script given no `response` cannot manufacture one.
public struct ScriptOutput: Sendable, Equatable {
    public var request: ScriptRequestContext?
    public var response: ScriptResponseContext?
    public var logs: [String]

    public init(request: ScriptRequestContext? = nil, response: ScriptResponseContext? = nil, logs: [String] = []) {
        self.request = request
        self.response = response
        self.logs = logs
    }
}

/// Every way a script execution can fail. Errors are surfaced through this
/// type rather than swallowed — a `ScriptRuntime` must throw, never return
/// a success value, for a script that threw, timed out, or failed to parse.
public enum ScriptError: Error, Sendable, Equatable {
    /// The script did not finish within `ScriptInput.timeout` and was
    /// stopped. A conforming runtime must guarantee the script is not still
    /// running (consuming CPU, holding state) after this is thrown — the
    /// bar is "actually stopped", not "reported as slow".
    case timeout
    /// The script threw a JavaScript exception, or failed to parse. The
    /// associated string is the engine's own description, unmodified.
    case runtimeError(String)
}
