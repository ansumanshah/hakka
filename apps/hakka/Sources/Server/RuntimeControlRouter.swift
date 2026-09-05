import Foundation
import HakkaCommon

/// Owned by BridgeHub's actor. Acknowledged frames never use legacy broadcast.
struct RuntimeControlRouter {
    struct Peer {
        let targetId: String
        var role = "runtime"
        var runtime = "unknown"
        var capabilities: [String] = []
        var acknowledged = false
        var commands: Set<String> = []
    }

    struct Pending {
        let owner: UUID
        let target: UUID
        let targetId: String
        let deadline: TimeInterval
    }

    typealias Delivery = (UUID, String)
    private var peers: [UUID: Peer] = [:]
    private var pending: [String: Pending] = [:]

    mutating func add(_ id: UUID) -> [Delivery] {
        guard peers[id] == nil else { return [] }
        peers[id] = Peer(targetId: UUID().uuidString.lowercased())
        return snapshots()
    }

    mutating func remove(_ id: UUID) -> [Delivery] {
        peers.removeValue(forKey: id)
        var output: [Delivery] = []
        for (commandId, request) in pending where request.target == id || request.owner == id {
            pending.removeValue(forKey: commandId)
            if request.owner != id {
                output += result(commandId, request.targetId, to: request.owner, error: "target_disconnected")
            }
        }
        return output + snapshots()
    }

    mutating func receive(_ frame: RuntimeControlFrame, raw: String, from sender: UUID, now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> [Delivery] {
        guard var peer = peers[sender] else { return [] }
        switch frame {
        case let .hello(role, runtime, capabilities):
            peer.role = role; peer.runtime = runtime
            peer.capabilities = role == "controller" ? [] : capabilities
            peer.acknowledged = true
            peers[sender] = peer
            let welcome = encodeRuntimeControlFrame("runtime.welcome", payload: ["targetId": peer.targetId])!
            return [(sender, welcome)] + snapshots()
        case let .request(request):
            guard peer.role == "controller", peer.acknowledged else { return [] }
            // Stop accepting new IDs at the bound rather than forgetting IDs and reapplying retries.
            if peer.commands.contains(request.commandId) {
                return pending[request.commandId] == nil ? result(request.commandId, request.targetId, to: sender, error: "apply_failed") : []
            }
            guard peer.commands.count < 4096, pending.count < 1024 else {
                return result(request.commandId, request.targetId, to: sender, error: "apply_failed")
            }
            guard pending[request.commandId] == nil else { return [] }
            peer.commands.insert(request.commandId)
            peers[sender] = peer
            guard let (targetID, target) = peers.first(where: { $0.value.targetId == request.targetId && $0.value.role != "controller" }) else {
                return result(request.commandId, request.targetId, to: sender, error: "target_not_found")
            }
            guard target.acknowledged else {
                return result(request.commandId, request.targetId, to: sender, error: "legacy_unacknowledged")
            }
            guard target.capabilities.contains(request.kind) else {
                return result(request.commandId, request.targetId, to: sender, error: "unsupported_capability")
            }
            pending[request.commandId] = Pending(owner: sender, target: targetID, targetId: target.targetId, deadline: now + Double(request.timeoutMs) / 1000)
            return [(targetID, raw)]
        case let .result(response):
            guard let request = pending[response.commandId], request.target == sender,
                  request.targetId == response.targetId else { return [] }
            pending.removeValue(forKey: response.commandId)
            if request.deadline <= now {
                return result(response.commandId, response.targetId, to: request.owner, error: "timeout")
            }
            // Re-encode the parsed result so untrusted extra payload fields are not exposed to controllers.
            return [(request.owner, encodeRuntimeControlFrame("control.result", payload: response)!)]
        default: return []
        }
    }

    mutating func expire(_ commandId: String, now: TimeInterval = ProcessInfo.processInfo.systemUptime) -> [Delivery] {
        guard let request = pending[commandId], request.deadline <= now else { return [] }
        pending.removeValue(forKey: commandId)
        return result(commandId, request.targetId, to: request.owner, error: "timeout")
    }

    private func result(_ commandId: String, _ targetId: String, to owner: UUID, error: String) -> [Delivery] {
        guard peers[owner] != nil else { return [] }
        return [(owner, encodeRuntimeControlFrame("control.result", payload: RuntimeControlResult(commandId: commandId, targetId: targetId, error: error))!)]
    }

    private func snapshots() -> [Delivery] {
        let targets = peers.values.filter { $0.role != "controller" }.map {
            RuntimeControlTarget(id: $0.targetId, runtime: $0.runtime, capabilities: $0.capabilities, acknowledged: $0.acknowledged)
        }.sorted { $0.id < $1.id }
        // Match the shared protocol's maximum target inventory size.
        guard targets.count <= 1024,
              let raw = encodeRuntimeControlFrame("runtime.targets", payload: ["targets": targets]) else { return [] }
        return peers.filter { $0.value.role == "controller" }.map { ($0.key, raw) }
    }
}
