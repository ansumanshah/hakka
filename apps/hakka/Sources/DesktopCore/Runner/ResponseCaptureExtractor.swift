import Foundation
import HakkaCommon

enum ResponseCaptureExtractor {
    /// Writes every enabled capture whose source resolves to a value into
    /// `scope.runtime`. A capture whose source doesn't resolve (a jsonPath
    /// with no match, a missing header) is silently skipped — the *next*
    /// request's missing-variable refusal is where that becomes visible, not
    /// this step.
    static func apply(_ captures: [ResponseCapture], record: NetworkRequest, into scope: inout VariableScope) {
        for capture in captures where capture.enabled {
            if let value = ResponseFieldExtractor.value(for: capture.source, in: record) {
                scope.setRuntime(capture.variable, value)
            }
        }
    }
}
