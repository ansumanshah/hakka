import HakkaCommon
import HakkaCore

/// The subset of `TrafficModel` that `RulesModel` actually depends on: the
/// rule store and the ability to push a control command to connected
/// devices. `TrafficModel` itself needs a live `BridgeServer` to construct,
/// so nothing exercises `RulesModel`'s rollback logic without binding a real
/// socket — this protocol is the narrow seam that lets a test stand in a
/// fake instead. It changes nothing about `TrafficModel`'s own shape or how
/// `AppModel` wires it up.
@MainActor
protocol RuleControlChannel: AnyObject {
    var rules: RuleStore { get }

    @discardableResult
    func send(_ command: ControlCommand) async throws -> Int
}

extension TrafficModel: RuleControlChannel {}
