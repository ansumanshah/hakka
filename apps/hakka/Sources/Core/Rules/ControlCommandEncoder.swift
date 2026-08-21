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
/// - `breakpoint.resume`: `{"kind":"breakpoint.resume","pauseId":...,
///   "requestEdits"?:{ url?, method?, headers?, body? },
///   "responseEdits"?:{ status?, headers?, body? }}`; `breakpoint.abort`:
///   `{"kind":"breakpoint.abort","pauseId":...}`.
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
///
/// Direction: `breakpoint.paused` travels device -> host only — this host
/// encoder refuses to produce it (`ControlWireError.unsupportedDirection`)
/// rather than silently emitting a frame no device would ever expect from a
/// host. `breakpoint.resume` / `.abort` are host -> device and encode
/// normally.
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
        case .breakpointPaused:
            // Device -> host only. A host has no pause of its own to report —
            // encoding this here would produce a frame no device's
            // `parseControlCommand` is ever meant to receive from a host.
            throw ControlWireError.unsupportedDirection("breakpoint.paused")
        case let .breakpointResume(pauseId, requestEdits, responseEdits):
            let id = try validPauseID(pauseId)
            var object: [String: Any] = ["kind": "breakpoint.resume", "pauseId": id]
            if let requestEdits { object["requestEdits"] = requestEditsObject(requestEdits) }
            if let responseEdits { object["responseEdits"] = responseEditsObject(responseEdits) }
            return object
        case let .breakpointAbort(pauseId):
            let id = try validPauseID(pauseId)
            return ["kind": "breakpoint.abort", "pauseId": id]
        case let .throttleSet(profile, latencyMs, downloadKbps):
            return try throttleObject(profile: profile, latencyMs: latencyMs, downloadKbps: downloadKbps)
        }
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

    static func removeObject(kind: String, id: String) throws -> [String: Any] {
        try validateExternalID(id)
        return ["kind": kind, "id": id]
    }
}
