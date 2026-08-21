import Foundation
import HakkaCommon

/// The outcome of one `RequestRunner.run` call: the same `NetworkRequest`
/// record type captured traffic uses, this run's assertion outcomes, and the
/// input `VariableScope` with any captures folded into `runtime` — pass it
/// straight into the next request in a chain.
public struct RunResult: Sendable, Equatable {
    public let record: NetworkRequest
    public let assertionResults: [AssertionResult]
    public let scope: VariableScope
    /// Set when this request had a post-response script and it threw or
    /// timed out. `nil` for a request with no post-response script, or one
    /// that ran cleanly — never conflated with `record.error`, which is a
    /// transport failure, not a scripting one. See `RequestScriptHooks`.
    public let scriptError: String?

    public init(
        record: NetworkRequest,
        assertionResults: [AssertionResult],
        scope: VariableScope,
        scriptError: String? = nil,
    ) {
        self.record = record
        self.assertionResults = assertionResults
        self.scope = scope
        self.scriptError = scriptError
    }
}
