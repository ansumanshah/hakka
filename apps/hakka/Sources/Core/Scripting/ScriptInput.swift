import Foundation

/// Everything one script execution needs. Each `run` is a single, isolated
/// call — a conforming runtime owes no state to a previous or following
/// call, and two calls on the same runtime instance must not be able to see
/// each other's globals.
public struct ScriptInput: Sendable {
    /// The script source, evaluated as a JavaScript program (top-level
    /// statements, not a function body).
    public var source: String
    /// Read-only key/value pairs exposed to the script as the `env` global.
    public var env: [String: String]
    /// Present when the script may read/mutate an in-flight request.
    public var request: ScriptRequestContext?
    /// Present when the script may read/mutate a received response.
    public var response: ScriptResponseContext?
    /// Wall-clock budget in seconds. A script that has not returned within
    /// this window is forcibly stopped, not merely reported as slow —
    /// see `ScriptRuntime.run`.
    public var timeout: TimeInterval

    public init(
        source: String,
        env: [String: String] = [:],
        request: ScriptRequestContext? = nil,
        response: ScriptResponseContext? = nil,
        timeout: TimeInterval = 5
    ) {
        self.source = source
        self.env = env
        self.request = request
        self.response = response
        self.timeout = timeout
    }
}
