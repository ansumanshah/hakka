import Foundation

/// Connection-local runtime state. Access only from the bridge client's serial queue.
final class RuntimeControlSession {
    private var targetId: String?
    private var results: [String: RuntimeControlResult] = [:]
    private let capacity = 1024

    func reset() {
        targetId = nil; results.removeAll()
    }

    func receive(_ frame: RuntimeControlFrame, apply: (ControlCommand) -> ControlApplyResult) -> RuntimeControlResult? {
        switch frame {
        case let .welcome(id):
            // A connection has one identity; repeated welcomes cannot reset duplicate protection.
            if targetId == nil {
                targetId = id
            }
            return nil
        case let .request(request):
            guard request.targetId == targetId else { return nil }
            if let result = results[request.commandId] {
                return result
            }
            guard results.count < capacity else {
                return RuntimeControlResult(commandId: request.commandId, targetId: request.targetId, error: "apply_failed")
            }
            let error: String? = if !RuntimeControlFrame.nativeCapabilities.contains(request.kind) || request.command == nil {
                "unsupported_capability"
            } else if case .failure = apply(request.command!) {
                "apply_failed"
            } else {
                nil
            }
            let result = RuntimeControlResult(commandId: request.commandId, targetId: request.targetId, error: error)
            results[request.commandId] = result
            return result
        default: return nil
        }
    }
}
