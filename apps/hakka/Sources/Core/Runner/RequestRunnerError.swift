import Foundation

/// Failures that stop a run before any bytes go on the wire. Once a
/// `URLRequest` is built, a network failure is recorded as `record.error` in
/// the returned `RunResult` instead of being thrown — see `RequestRunner`.
public enum RequestRunnerError: Error, Equatable, Sendable {
    case resolution(RequestResolutionError)
    case bodyEncoding(RequestBodyEncodingError)
    /// A pre-request script threw or timed out. Thrown before resolution —
    /// see `RequestScriptHooks`'s abort-not-proceed rationale — so nothing
    /// the script was supposed to sign or transform ever reaches the wire
    /// unmodified. A post-response script failure is never one of these
    /// cases; it surfaces as `RunResult.scriptError` instead, because the
    /// response it ran against already happened.
    case script(ScriptError)
}
