// @generated — do not edit. Synced from ios/Sources/Common/ControlCommandParsing.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

// MARK: - parseControlCommand
//
// The switch below is the top-level decode boundary — every kind's own
// shape validation lives in `ControlCommandParsingMock.swift` /
// `ControlCommandParsingBreakpoint.swift`. This file stays a thin dispatch
// table on purpose so it — and its siblings — each stay under 200 lines.

/// Validate an untyped JSON payload (already decoded to Foundation objects,
/// e.g. via `JSONSerialization`) into a `ControlCommand`. Strict shape
/// checking — returns `nil` on anything malformed. Never throws.
public func parseControlCommand(_ raw: Any?) -> ControlCommand? {
    guard let obj = asObject(raw) else { return nil }
    guard let kind = obj["kind"] as? String else { return nil }

    switch kind {
    case "mock.add":
        guard let (id, rule) = parseMockRuleInput(obj["rule"]) else { return nil }
        return .mockAdd(id: id, rule: rule)

    case "mock.remove":
        guard let id = obj["id"] as? String, isExternalId(id) else { return nil }
        return .mockRemove(id: id)

    case "mock.clear":
        return .mockClear

    case "breakpoint.add":
        guard let (id, breakpoint) = parseBreakpointInput(obj["breakpoint"]) else { return nil }
        return .breakpointAdd(id: id, breakpoint: breakpoint)

    case "breakpoint.remove":
        guard let id = obj["id"] as? String, isExternalId(id) else { return nil }
        return .breakpointRemove(id: id)

    case "breakpoint.paused":
        return parseBreakpointPausedCommand(obj)

    case "breakpoint.resume":
        guard let pauseId = obj["pauseId"] as? String, isPauseId(pauseId) else { return nil }

        var requestEdits: BreakpointRequestEdits?
        if let raw = obj["requestEdits"], !(raw is NSNull) {
            guard let edits = parseBreakpointRequestEdits(raw) else { return nil }
            requestEdits = edits
        }
        var responseEdits: BreakpointResponseEdits?
        if let raw = obj["responseEdits"], !(raw is NSNull) {
            guard let edits = parseBreakpointResponseEdits(raw) else { return nil }
            responseEdits = edits
        }
        return .breakpointResume(pauseId: pauseId, requestEdits: requestEdits, responseEdits: responseEdits)

    case "breakpoint.abort":
        guard let pauseId = obj["pauseId"] as? String, isPauseId(pauseId) else { return nil }
        return .breakpointAbort(pauseId: pauseId)

    case "throttle.set":
        guard let profileRaw = obj["profile"] as? String, throttleProfileValues.contains(profileRaw),
              let profile = ThrottleProfile(rawValue: profileRaw) else { return nil }

        var latencyMs: Int?
        if let raw = obj["latencyMs"] {
            guard let n = raw as? NSNumber else { return nil }
            let ms = n.doubleValue
            guard ms.isFinite, ms >= 0 else { return nil }
            latencyMs = Int(ms)
        }

        var downloadKbps: Int?
        if let raw = obj["downloadKbps"] {
            guard let n = raw as? NSNumber else { return nil }
            let kbps = n.doubleValue
            guard kbps.isFinite, kbps >= 0 else { return nil }
            downloadKbps = Int(kbps)
        }

        return .throttleSet(profile: profile, latencyMs: latencyMs, downloadKbps: downloadKbps)

    default:
        return nil
    }
}

/// `breakpoint.paused` has enough fields that inlining it in the switch above
/// would push this file over 200 lines — pulled into its own function.
private func parseBreakpointPausedCommand(_ obj: [String: Any]) -> ControlCommand? {
    guard let pauseId = obj["pauseId"] as? String, isPauseId(pauseId) else { return nil }

    var ruleId: String?
    if let raw = obj["ruleId"], !(raw is NSNull) {
        guard let s = raw as? String, isExternalId(s) else { return nil }
        ruleId = s
    }

    guard let phaseRaw = obj["phase"] as? String, pausePhaseValues.contains(phaseRaw),
          let phase = BreakpointPhase(rawValue: phaseRaw) else { return nil }

    guard let device = obj["device"] as? String, !device.isEmpty, device.utf8.count <= maxDeviceLength else { return nil }

    guard let request = parseBreakpointPausedRequestSnapshot(obj["request"]) else { return nil }

    var response: BreakpointPausedResponseSnapshot?
    if let raw = obj["response"], !(raw is NSNull) {
        guard let r = parseBreakpointPausedResponseSnapshot(raw) else { return nil }
        response = r
    }

    return .breakpointPaused(pauseId: pauseId, ruleId: ruleId, phase: phase, device: device, request: request, response: response)
}

/// Parse a raw JSON text frame's `payload` field directly from `Data`.
/// Convenience wrapper around `parseControlCommand(_:)` for callers that
/// have not yet decoded the frame (e.g. `HakkaBridgeClient`'s receive loop).
public func parseControlCommand(fromPayloadJSON data: Data) -> ControlCommand? {
    guard let obj = try? JSONSerialization.jsonObject(with: data) else { return nil }
    return parseControlCommand(obj)
}
