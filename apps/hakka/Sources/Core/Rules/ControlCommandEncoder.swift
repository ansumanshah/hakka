import Foundation
import HakkaCommon

/// Encodes the typed `ControlCommand` (HakkaCommon — the same vocabulary
/// every device runtime decodes with `parseControlCommand`) into the wire
/// payload object, validating every field as it goes. This is the send-side
/// mirror of that strict parser: a malformed field throws `ControlWireError`
/// here instead of being coerced, because a command the receiving device
/// would drop must never be written to the socket in the first place.
///
/// Wire field names — pinned by `packages/hakka-core/src/engine/control.ts`
/// (cross-checked against its tests and the Node hub's relay tests):
///
/// - `mock.add`: `{"kind":"mock.add","rule":{ id, pattern, enabled,
///   response:{ status, body, headers?, delay? }, method?, redirectTo?,
///   block?, modify? }}` where `modify` is
///   `{ setRequestHeaders?, removeRequestHeaders?, setQueryParams?,
///   removeQueryParams?, status?, setResponseHeaders?,
///   removeResponseHeaders?, replaceBody?:[{ find, replace }] }`.
/// - `mock.remove`: `{"kind":"mock.remove","id":...}`;
///   `mock.clear`: `{"kind":"mock.clear"}`.
/// - `breakpoint.add`: `{"kind":"breakpoint.add","breakpoint":{ id, pattern,
///   on, enabled, method? }}`; `breakpoint.remove`:
///   `{"kind":"breakpoint.remove","id":...}`.
/// - `throttle.set`: `{"kind":"throttle.set","profile":...,"latencyMs?:...,
///   "downloadKbps"?:...}`.
///
/// Deliberately omitted fields: `mode` (both engines route a rule through
/// the rewrite path purely because it declares `redirectTo`/`modify`, and
/// both parsers treat `mode` as optional with no effect), and the mock
/// engine's `isRegex`/`regexFlags` (the `mock.add` wire shape has no regex
/// fields — devices match patterns as substrings). Optional fields absent
/// from the typed value are omitted rather than emitted as nulls, matching
/// the field-absent shapes the contract's own tests pin.
public enum ControlCommandEncoder {
    /// External ids must match `^[A-Za-z0-9_-]{1,64}$` — the same pattern
    /// the device-side parser enforces on every id-bearing command. Internal
    /// (not public) so `RuleStore` shares one definition of a legal id with
    /// the encoder rather than reimplementing it.
    static func validateExternalID(_ id: String) throws {
        guard !id.isEmpty,
            id.utf8.count <= 64,
            id.range(of: "^[A-Za-z0-9_-]{1,64}$", options: .regularExpression) != nil
        else { throw ControlWireError.invalidRuleID(id) }
    }

    /// The wire payload object for `command` — the exact inner shape the
    /// device-side `parseControlCommand` accepts. Key order is irrelevant to
    /// receivers; serialization order is fixed by `encodePayload`.
    public static func payloadObject(for command: ControlCommand) throws -> [String: Any] {
        switch command {
        case let .mockAdd(id, rule):
            return ["kind": "mock.add", "rule": try mockRuleObject(id: id, rule: rule)]
        case let .mockRemove(id):
            return try removeObject(kind: "mock.remove", id: id)
        case .mockClear:
            return ["kind": "mock.clear"]
        case let .breakpointAdd(id, breakpoint):
            return ["kind": "breakpoint.add", "breakpoint": try breakpointObject(id: id, breakpoint: breakpoint)]
        case let .breakpointRemove(id):
            return try removeObject(kind: "breakpoint.remove", id: id)
        case let .throttleSet(profile, latencyMs, downloadKbps):
            return try throttleObject(profile: profile, latencyMs: latencyMs, downloadKbps: downloadKbps)
        }
    }

    /// Pause ids come from the pausing device, not this host — mirror the
    /// device parser's non-empty check without the external-id charset rule
    /// (a device may quote its own ids however it likes).
    private static func validPauseID(_ pauseId: String) throws -> String {
        guard !pauseId.isEmpty else { throw ControlWireError.invalidRuleID(pauseId) }
        return pauseId
    }

    private static func pausedRequestObject(_ request: PausedRequest) -> [String: Any] {
        var object: [String: Any] = [
            "url": request.url,
            "method": request.method,
            "headers": request.headers,
        ]
        if let body = request.body {
            object["body"] = body
        }
        return object
    }

    /// The payload as deterministic JSON bytes: `.sortedKeys` fixes every
    /// key's position so tests (and logs) can pin exact bytes.
    public static func encodePayload(_ command: ControlCommand) throws -> Data {
        let object = try payloadObject(for: command)
        do {
            return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        } catch {
            throw ControlWireError.encodingFailed(String(describing: error))
        }
    }

    // MARK: - Command bodies

    private static func removeObject(kind: String, id: String) throws -> [String: Any] {
        try validateExternalID(id)
        return ["kind": kind, "id": id]
    }

    private static func mockRuleObject(id: String, rule: MockRuleInput) throws -> [String: Any] {
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
        return object
    }

    private static func modifyObject(_ modify: MockRuleModify) -> [String: Any] {
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

    private static func breakpointObject(id: String, breakpoint: BreakpointInput) throws -> [String: Any] {
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

    private static func throttleObject(profile: ThrottleProfile, latencyMs: Int?, downloadKbps: Int?) throws -> [String: Any] {
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
}
