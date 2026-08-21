import Foundation
import HakkaCommon

/// One breakpoint pause reported by a device, held until this desktop
/// resumes or aborts it — or its own timeout fires (see
/// `PauseInboxModel.autoAbortTimeout`). `pauseId` is minted by the pausing
/// device and is the wire identity a `breakpoint.resume`/`.abort` echoes
/// back; `device` is a separate, purely-display identifier. Together they
/// are what make two pauses arriving at the same instant — the same rule
/// firing twice on one device, or two different devices hitting the same
/// breakpoint — distinguishable in the inbox: same `device` but different
/// `pauseId`, or the reverse.
public struct PendingPause: Sendable, Equatable, Identifiable {
    public let pauseId: String
    public let ruleId: String?
    public let phase: BreakpointPhase
    /// The device identifier the paused device reported. Display-only:
    /// nothing here maps it back to a specific bridge socket connection, so
    /// losing that connection is not detectable per-pause (see the
    /// `abortAllForTermination`/timeout doc comments in `PauseInboxModel`
    /// for how the desktop copes with an unreachable device anyway).
    public let device: String
    public var request: BreakpointPausedRequestSnapshot
    /// Present only when `phase == .response`.
    public var response: BreakpointPausedResponseSnapshot?
    /// When this pause arrived — the origin for the auto-abort timeout and
    /// for the "paused Ns ago" the inbox displays.
    public let arrivedAt: Date

    public var id: String { pauseId }

    public init(
        pauseId: String,
        ruleId: String?,
        phase: BreakpointPhase,
        device: String,
        request: BreakpointPausedRequestSnapshot,
        response: BreakpointPausedResponseSnapshot?,
        arrivedAt: Date = Date()
    ) {
        self.pauseId = pauseId
        self.ruleId = ruleId
        self.phase = phase
        self.device = device
        self.request = request
        self.response = response
        self.arrivedAt = arrivedAt
    }

    /// Builds from the device -> host `ControlCommand`. `nil` for any other
    /// command kind. `PauseStore.ingest` is the only caller and it already
    /// only ever sees commands `BridgeHub.hostControls` filtered through
    /// `isDeviceToHostCommand`, but this stays defensive — pattern-matching
    /// rather than force-unwrapping the one case it expects — instead of
    /// trusting that filter never to change out from under it.
    public init?(command: ControlCommand) {
        guard case let .breakpointPaused(pauseId, ruleId, phase, device, request, response) = command else { return nil }
        self.init(pauseId: pauseId, ruleId: ruleId, phase: phase, device: device, request: request, response: response)
    }
}
