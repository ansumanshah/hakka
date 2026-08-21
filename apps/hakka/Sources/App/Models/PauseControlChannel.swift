import HakkaCommon
import HakkaCore

/// The subset of `TrafficModel` that `PauseInboxModel` depends on — the same
/// seam `RuleControlChannel` gives `RulesModel`, for the same reason:
/// `TrafficModel` needs a live `BridgeServer` to construct, so nothing
/// exercises `PauseInboxModel`'s resume/abort/timeout logic without binding
/// a real socket unless a fake can stand in here instead.
@MainActor
protocol PauseControlChannel: AnyObject {
    var pauses: PauseStore { get }

    @discardableResult
    func send(_ command: ControlCommand) async throws -> Int
}

extension TrafficModel: PauseControlChannel {}
