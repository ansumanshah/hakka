import CoreFoundation
import Foundation

/// Additive bridge control frames. Native runtimes intentionally omit replay and storage mutation.
public enum RuntimeControlFrame: Sendable {
    public static let nativeCapabilities = ["mock.add", "mock.remove", "mock.clear", "breakpoint.add", "breakpoint.remove", "breakpoint.resume", "breakpoint.abort", "throttle.set"]
    public static let capabilities = nativeCapabilities + ["request.replay"]
    public static let runtimes = ["browser", "react-native", "ios", "android", "server", "edge", "unknown"]
    public static let errors = ["unsupported_capability", "target_disconnected", "apply_failed", "legacy_unacknowledged", "target_not_found", "timeout", "target_required", "bridge_disconnected"]

    case hello(role: String, runtime: String, capabilities: [String])
    case welcome(targetId: String)
    case targets([RuntimeControlTarget])
    case request(RuntimeControlRequest)
    case result(RuntimeControlResult)
}

public struct RuntimeControlTarget: Codable, Sendable {
    public let id: String
    public let runtime: String
    public let capabilities: [String]
    public let acknowledged: Bool

    public init(id: String, runtime: String, capabilities: [String], acknowledged: Bool) {
        self.id = id; self.runtime = runtime; self.capabilities = capabilities; self.acknowledged = acknowledged
    }
}

public struct RuntimeControlRequest: Sendable {
    public let commandId: String
    public let targetId: String
    public let kind: String
    public let command: ControlCommand?
    public let timeoutMs: Int
}

public struct RuntimeControlResult: Codable, Sendable, Equatable {
    public let commandId: String
    public let targetId: String
    public let status: String
    public let error: String?

    public init(commandId: String, targetId: String, error: String? = nil) {
        self.commandId = commandId; self.targetId = targetId
        status = error == nil ? "applied" : "failed"; self.error = error
    }
}

private struct RuntimeControlEnvelope<Value: Encodable>: Encodable { let type: String; let payload: Value }

public func encodeRuntimeControlFrame(_ type: String, payload: some Encodable) -> String? {
    guard let data = try? JSONEncoder().encode(RuntimeControlEnvelope(type: type, payload: payload)) else { return nil }
    return String(data: data, encoding: .utf8)
}

private func validCapabilities(_ raw: Any?) -> [String]? {
    guard let values = raw as? [String], values.count <= RuntimeControlFrame.capabilities.count,
          Set(values).count == values.count, values.allSatisfy(RuntimeControlFrame.capabilities.contains) else { return nil }
    return values
}

/// Strict parse with the same identifier, capability and timeout bounds as runtime control v1.
public func parseRuntimeControlFrame(_ raw: String) -> RuntimeControlFrame? {
    guard raw.utf8.count <= 8 * 1024 * 1024,
          let obj = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
          let payload = obj["payload"] as? [String: Any] else { return nil }
    switch obj["type"] as? String {
    case "runtime.hello":
        guard let role = payload["role"] as? String, ["runtime", "controller"].contains(role),
              let version = payload["protocolVersion"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), version.doubleValue == 1,
              let runtime = payload["runtime"] as? String, RuntimeControlFrame.runtimes.contains(runtime),
              let capabilities = validCapabilities(payload["capabilities"]) else { return nil }
        return .hello(role: role, runtime: runtime, capabilities: capabilities)
    case "runtime.welcome":
        guard let id = payload["targetId"] as? String, isExternalId(id) else { return nil }
        return .welcome(targetId: id)
    case "runtime.targets":
        guard let values = payload["targets"] as? [[String: Any]], values.count <= 1024 else { return nil }
        var targets: [RuntimeControlTarget] = []
        for value in values {
            guard let id = value["id"] as? String, isExternalId(id),
                  let runtime = value["runtime"] as? String, RuntimeControlFrame.runtimes.contains(runtime),
                  let capabilities = validCapabilities(value["capabilities"]),
                  let acknowledged = value["acknowledged"] as? NSNumber,
                  CFGetTypeID(acknowledged) == CFBooleanGetTypeID() else { return nil }
            targets.append(RuntimeControlTarget(id: id, runtime: runtime, capabilities: capabilities, acknowledged: acknowledged.boolValue))
        }
        return .targets(targets)
    case "control.request":
        guard let commandId = payload["commandId"] as? String, isExternalId(commandId),
              let targetId = payload["targetId"] as? String, isExternalId(targetId),
              let timeout = payload["timeoutMs"] as? NSNumber, CFGetTypeID(timeout) != CFBooleanGetTypeID(),
              timeout.doubleValue.rounded() == timeout.doubleValue, (1 ... 30000).contains(timeout.doubleValue),
              let commandPayload = payload["command"] as? [String: Any], let kind = commandPayload["kind"] as? String else { return nil }
        let command = parseControlCommand(commandPayload)
        if kind == "request.replay" {
            guard let id = commandPayload["requestId"] as? String, !id.isEmpty else { return nil }
            if let marker = commandPayload["replayMarker"] {
                guard let id = marker as? String, isExternalId(id) else { return nil }
            }
        } else {
            guard let command, !isDeviceToHostCommand(command) else { return nil }
        }
        return .request(RuntimeControlRequest(commandId: commandId, targetId: targetId, kind: kind, command: command, timeoutMs: timeout.intValue))
    case "control.result":
        guard let commandId = payload["commandId"] as? String, isExternalId(commandId),
              let targetId = payload["targetId"] as? String, isExternalId(targetId),
              let status = payload["status"] as? String else { return nil }
        if status == "applied", payload["error"] == nil {
            return .result(RuntimeControlResult(commandId: commandId, targetId: targetId))
        }
        guard status == "failed", let error = payload["error"] as? String, RuntimeControlFrame.errors.contains(error) else { return nil }
        return .result(RuntimeControlResult(commandId: commandId, targetId: targetId, error: error))
    default: return nil
    }
}
