import Foundation
import HakkaCommon

// MARK: - Command bodies (mock.add / breakpoint.add / throttle.set)
//
// Split out of `ControlCommandEncoder.swift` to keep files under 200 lines.
// `internal` (module-default) visibility — shared with `ControlCommandEncoder.swift`.

extension ControlCommandEncoder {
    static func mockRuleObject(id: String, rule: MockRuleInput) throws -> [String: Any] {
        try validateExternalID(id)
        guard !rule.pattern.isEmpty else { throw ControlWireError.emptyPattern }

        // The wire carries whole milliseconds; the native engine stores
        // seconds. Round to nearest so a 50 ms authored delay survives the
        // seconds<->ms round trip exactly.
        guard rule.response.delay.isFinite, rule.response.delay >= 0 else {
            throw ControlWireError.invalidDelay(rule.response.delay)
        }

        var response: [String: Any] = [
            "status": rule.response.status,
            // The wire body is required and cannot be null — an absent native
            // body encodes as the empty string.
            "body": rule.response.body ?? "",
        ]
        if !rule.response.headers.isEmpty { response["headers"] = rule.response.headers }
        if rule.response.delay > 0 { response["delay"] = Int((rule.response.delay * 1000).rounded()) }

        var object: [String: Any] = [
            "id": id,
            "pattern": rule.pattern,
            "enabled": rule.enabled,
            "response": response,
        ]
        if let method = rule.method { object["method"] = method }
        if let redirectTo = rule.redirectTo { object["redirectTo"] = redirectTo }
        if rule.block { object["block"] = true }
        if let modify = rule.modify { object["modify"] = modifyObject(modify) }
        if let failure = rule.failure { object["failure"] = ["code": failure.code.rawValue] }
        if rule.skipCount > 0 { object["skipCount"] = rule.skipCount }
        if let stopAfter = rule.stopAfter { object["stopAfter"] = stopAfter }
        return object
    }

    static func modifyObject(_ modify: MockRuleModify) -> [String: Any] {
        var object: [String: Any] = [:]
        if let v = modify.setRequestHeaders { object["setRequestHeaders"] = v }
        if let v = modify.removeRequestHeaders { object["removeRequestHeaders"] = v }
        if let v = modify.setQueryParams { object["setQueryParams"] = v }
        if let v = modify.removeQueryParams { object["removeQueryParams"] = v }
        if let v = modify.status { object["status"] = v }
        if let v = modify.setResponseHeaders { object["setResponseHeaders"] = v }
        if let v = modify.removeResponseHeaders { object["removeResponseHeaders"] = v }
        if let v = modify.replaceBody {
            object["replaceBody"] = v.map { ["find": $0.find, "replace": $0.replace] }
        }
        return object
    }

    static func breakpointObject(id: String, breakpoint: BreakpointInput) throws -> [String: Any] {
        try validateExternalID(id)
        guard !breakpoint.pattern.isEmpty else { throw ControlWireError.emptyPattern }

        var object: [String: Any] = [
            "id": id,
            "pattern": breakpoint.pattern,
            "on": breakpoint.on.rawValue,
            "enabled": breakpoint.enabled,
        ]
        if let method = breakpoint.method { object["method"] = method }
        return object
    }

    static func throttleObject(profile: ThrottleProfile, latencyMs: Int?, downloadKbps: Int?) throws -> [String: Any] {
        var object: [String: Any] = [
            "kind": "throttle.set",
            // A typed enum can only hold raw values the contract lists, so an
            // unknown profile is unrepresentable at this API — the loud
            // failure for those lives on the parse side.
            "profile": profile.rawValue,
        ]
        if let latencyMs {
            guard latencyMs >= 0 else { throw ControlWireError.invalidLatencyMs(latencyMs) }
            object["latencyMs"] = latencyMs
        }
        if let downloadKbps {
            guard downloadKbps >= 0 else { throw ControlWireError.invalidDownloadKbps(downloadKbps) }
            object["downloadKbps"] = downloadKbps
        }
        return object
    }

    /// Pause ids come from the pausing device, not this host — mirror the
    /// device parser's non-empty check without the external-id charset rule
    /// (a device may quote its own ids however it likes).
    static func validPauseID(_ pauseId: String) throws -> String {
        guard !pauseId.isEmpty else { throw ControlWireError.invalidRuleID(pauseId) }
        return pauseId
    }

    /// `BreakpointRequestEdits` is already all-optional ("keep original if
    /// absent") — only present fields are emitted, matching the field-absent
    /// wire shape the device-side parsers accept.
    static func requestEditsObject(_ edits: BreakpointRequestEdits) -> [String: Any] {
        var object: [String: Any] = [:]
        if let v = edits.url { object["url"] = v }
        if let v = edits.method { object["method"] = v }
        if let v = edits.headers { object["headers"] = v }
        if let v = edits.body { object["body"] = v }
        return object
    }

    static func responseEditsObject(_ edits: BreakpointResponseEdits) -> [String: Any] {
        var object: [String: Any] = [:]
        if let v = edits.status { object["status"] = v }
        if let v = edits.headers { object["headers"] = v }
        if let v = edits.body { object["body"] = v }
        return object
    }
}
