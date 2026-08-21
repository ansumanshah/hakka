import Foundation

/// What a script produced: its (possibly mutated) request/response,
/// anything it logged, and any runtime variables it set. Only present when
/// the input carried the matching context — a script given no `response`
/// cannot manufacture one.
public struct ScriptOutput: Sendable, Equatable {
    public var request: ScriptRequestContext?
    public var response: ScriptResponseContext?
    public var logs: [String]
    /// Values written through the `vars.set(name, value)` global — how a
    /// post-response hook hands a value to the next request in a chain
    /// without a wider, ambient-write surface. Empty when the script never
    /// called `vars.set`.
    public var variables: [String: String]

    public init(
        request: ScriptRequestContext? = nil,
        response: ScriptResponseContext? = nil,
        logs: [String] = [],
        variables: [String: String] = [:],
    ) {
        self.request = request
        self.response = response
        self.logs = logs
        self.variables = variables
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
