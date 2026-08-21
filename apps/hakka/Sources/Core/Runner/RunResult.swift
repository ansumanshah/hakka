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

    public init(record: NetworkRequest, assertionResults: [AssertionResult], scope: VariableScope) {
        self.record = record
        self.assertionResults = assertionResults
        self.scope = scope
    }
}
