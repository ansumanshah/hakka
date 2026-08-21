import Foundation

/// Send-side failures for the control wire. These throw loudly from
/// `ControlCommandEncoder`, `ControlFrameEncoder`, `RuleStore.add`, and
/// `ControlSender` so a malformed rule can never reach a device as
/// silently-corrupted bytes — the mirror of the strict parse side
/// (`parseControlCommand` in HakkaCommon), which returns `nil` for the
/// same shapes instead of guessing at a repair.
public enum ControlWireError: Error, Equatable, Sendable {
    /// An external id that fails the wire pattern `^[A-Za-z0-9_-]{1,64}$`.
    /// Ids are minted by the sender and echoed back by remove commands, so
    /// anything looser (spaces, path separators, oversized) is refused
    /// rather than truncated or escaped.
    case invalidRuleID(String)
    /// A command this host can receive but never originate — pause
    /// notifications belong to devices.
    case unsupportedDirection(String)
    /// A rule pattern that is empty — every engine requires a non-empty
    /// match string.
    case emptyPattern
    /// A mock response delay (seconds) that is negative or not finite.
    case invalidDelay(TimeInterval)
    /// A negative throttle latency (ms).
    case invalidLatencyMs(Int)
    /// A negative throttle download bandwidth (kbps).
    case invalidDownloadKbps(Int)
    /// The serialized payload failed its own strict parse — bytes a
    /// receiving device would drop must never be written to the socket.
    case roundTripRejected
    /// The encoded frame exceeds the wire frame byte limit.
    case oversizedFrame(byteCount: Int, limit: Int)
    /// JSON serialization failed on a payload that is JSON-safe by
    /// construction — an internal invariant break, surfaced rather than
    /// swallowed.
    case encodingFailed(String)
}
