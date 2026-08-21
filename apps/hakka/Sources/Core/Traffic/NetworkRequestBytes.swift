import Foundation
import HakkaCommon

extension NetworkRequest {
    /// Request plus response body size, clamped so it can never trap.
    ///
    /// Both fields are `Int64` decoded straight off the wire (or out of a
    /// session file) with no range validation, and Swift's `+` traps on
    /// overflow in release as well as debug. A single frame declaring
    /// `requestBodySize: 9223372036854775807` alongside any positive response
    /// size was enough to kill the app — from an unauthenticated local peer,
    /// or from opening a corrupted `.hakka-session` file.
    ///
    /// Negatives are clamped to zero for the same reason: a size is a count of
    /// bytes, a negative one is corrupt input, and letting it through would
    /// quietly falsify the totals rather than announce itself.
    var totalBodyBytes: Int64 {
        let request = Swift.max(0, requestBodySize)
        let response = Swift.max(0, responseBodySize)
        let (sum, overflowed) = request.addingReportingOverflow(response)
        return overflowed ? .max : sum
    }
}

extension Int64 {
    /// `self + other`, saturating at the representable bounds instead of
    /// trapping. The running totals these feed are approximate by nature; a
    /// wrong number in a stats line is a far better outcome than a dead
    /// process.
    func saturatingAdding(_ other: Int64) -> Int64 {
        let (sum, overflowed) = addingReportingOverflow(other)
        guard overflowed else { return sum }
        return other > 0 ? .max : .min
    }

    /// `self - other`, saturating, and never below zero — every caller here is
    /// tracking a byte total that cannot meaningfully go negative.
    func saturatingSubtractingClampedToZero(_ other: Int64) -> Int64 {
        let (difference, overflowed) = subtractingReportingOverflow(other)
        if overflowed { return 0 }
        return Swift.max(0, difference)
    }
}
