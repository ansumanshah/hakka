import Foundation

// MARK: - ControlCommand
//
// Swift mirror of the control-channel contract in
// `packages/hakka-core/src/engine/control.ts` — the source of truth; read it
// first. A bridge peer (e.g. the MCP server) may send a JSON text frame:
// ```json
// { "type": "control", "payload": <ControlCommand> }
// ```
// over the same WebSocket used to stream captures. `parseControlCommand`
// validates an untyped payload into a `ControlCommand` — strict shape
// checking, never throws, returns `nil` on anything malformed.
// `applyControlCommand` drives the singleton engines (`MockEngine`,
// `BreakpointEngine`, `ThrottleEngine`). It is fail-open: any engine-call
// exception (or Swift `NSException`-free error) is caught and reported as
// `.failure(message)` — a malformed or unexpected command must never
// propagate into the host app.
//
// Id semantics: ids for `mock.add` / `breakpoint.add` are minted by the
// remote caller, not generated locally, so that peer can later remove the
// same rule cross-process. `MockEngine.addRule(_:id:)` /
// `BreakpointEngine.addBreakpoint(_:)` honor a caller-supplied id, replacing
// any existing rule/breakpoint with the same id in place (replace-by-id)
// rather than rejecting the add or creating a duplicate.
//
// Platform note: the iOS `MockEngine` carries `redirectTo` / `block` /
// `modify` (see `MockRuleModify.swift`) — parity with the TS engine's
// declarative surface. It still has no `mode` ("mock" vs "rewrite") concept or
// `rewriteRequest`/`rewriteResponse` functions (those cannot cross a native
// bridge); a rule is routed through `HakkaURLProtocol`'s passthrough-then-
// transform path purely because it declares `redirectTo` and/or `modify` —
// see `MockRule.isRewrite`. `mode` is still accepted (parsed, validated) for
// wire-shape compatibility but has no native effect.

/// External ids: minted by the remote caller, validated before use locally.
private let externalIdPattern = "^[A-Za-z0-9_-]{1,64}$"

private func isExternalId(_ s: String) -> Bool {
    guard !s.isEmpty, s.utf8.count <= 64 else { return false }
    return s.range(of: externalIdPattern, options: .regularExpression) != nil
}

private let throttleProfileValues: Set<String> = ["none", "fast-3g", "slow-3g", "offline", "edge", "custom"]
private let breakpointPhaseValues: Set<String> = ["request", "response", "both"]

// MARK: - ControlCommand

public enum ControlCommand: Sendable, Equatable {
    case mockAdd(id: String, rule: MockRuleInput)
    case mockRemove(id: String)
    case mockClear
    case breakpointAdd(id: String, breakpoint: BreakpointInput)
    case breakpointRemove(id: String)
    case throttleSet(profile: ThrottleProfile, latencyMs: Int?, downloadKbps: Int?)
}

// MARK: - Equatable conformances for embedded input types
// (Sendable already holds; Equatable is only needed for tests, added here
// to keep the engines' own files free of test-only conformances.)

extension MockRuleInput: Equatable {
    public static func == (lhs: MockRuleInput, rhs: MockRuleInput) -> Bool {
        lhs.pattern == rhs.pattern
            && lhs.isRegex == rhs.isRegex
            && lhs.method == rhs.method
            && lhs.enabled == rhs.enabled
            && lhs.regexFlags == rhs.regexFlags
            && lhs.response == rhs.response
            && lhs.redirectTo == rhs.redirectTo
            && lhs.block == rhs.block
            && lhs.modify == rhs.modify
    }
}

extension MockResponse: Equatable {
    public static func == (lhs: MockResponse, rhs: MockResponse) -> Bool {
        lhs.status == rhs.status && lhs.headers == rhs.headers && lhs.body == rhs.body && lhs.delay == rhs.delay
    }
}

extension BreakpointInput: Equatable {
    public static func == (lhs: BreakpointInput, rhs: BreakpointInput) -> Bool {
        lhs.pattern == rhs.pattern && lhs.method == rhs.method && lhs.on == rhs.on && lhs.enabled == rhs.enabled
    }
}

// MARK: - Parsing helpers

private func asObject(_ v: Any?) -> [String: Any]? {
    v as? [String: Any]
}

/// Validates the subset of `MockResponse` accepted over the wire (no
/// functions — those cannot cross the bridge).
private func parseMockResponse(_ v: Any?) -> MockResponse? {
    guard let obj = asObject(v) else { return nil }
    guard let statusNum = obj["status"] as? NSNumber else { return nil }
    let status = statusNum.intValue

    var headers: [String: String] = [:]
    if let rawHeaders = obj["headers"] {
        guard let headerObj = asObject(rawHeaders) else { return nil }
        for (k, v) in headerObj {
            guard let s = v as? String else { return nil }
            headers[k] = s
        }
    }

    let body: String?
    switch obj["body"] {
    case let s as String:
        body = s
    case let arr as [Any]:
        guard let data = try? JSONSerialization.data(withJSONObject: arr),
              let s = String(data: data, encoding: .utf8) else { return nil }
        body = s
    case let d as [String: Any]:
        guard JSONSerialization.isValidJSONObject(d),
              let data = try? JSONSerialization.data(withJSONObject: d),
              let s = String(data: data, encoding: .utf8) else { return nil }
        body = s
    case nil, is NSNull:
        body = nil
    default:
        return nil
    }

    var delay: TimeInterval = 0
    if let rawDelay = obj["delay"] {
        guard let n = rawDelay as? NSNumber else { return nil }
        let ms = n.doubleValue
        guard ms.isFinite, ms >= 0 else { return nil }
        delay = ms / 1000.0
    }

    return MockResponse(status: status, headers: headers, body: body, delay: delay)
}

/// Validates the `MockRuleModify` shape (see `MockRuleModify.swift`) — plain
/// data only, no functions. Matches `parseMockRuleInput`'s style: any
/// malformed sub-field rejects the whole `modify` block (and, via the caller,
/// the whole `mock.add` command) rather than silently dropping just that
/// field. Mirrors `control.ts`'s `parseMockRuleModify` exactly.
private func parseMockRuleModify(_ v: Any?) -> MockRuleModify? {
    guard let obj = asObject(v) else { return nil }

    func stringMap(_ key: String) -> [String: String]?? {
        guard let raw = obj[key], !(raw is NSNull) else { return .some(nil) }
        guard let dict = asObject(raw) else { return nil }
        var out: [String: String] = [:]
        for (k, val) in dict {
            guard let s = val as? String else { return nil }
            out[k] = s
        }
        return .some(out)
    }

    func stringArray(_ key: String) -> [String]?? {
        guard let raw = obj[key], !(raw is NSNull) else { return .some(nil) }
        guard let arr = raw as? [Any] else { return nil }
        var out: [String] = []
        for item in arr {
            guard let s = item as? String else { return nil }
            out.append(s)
        }
        return .some(out)
    }

    guard let setRequestHeaders = stringMap("setRequestHeaders") else { return nil }
    guard let removeRequestHeaders = stringArray("removeRequestHeaders") else { return nil }
    guard let setQueryParams = stringMap("setQueryParams") else { return nil }
    guard let removeQueryParams = stringArray("removeQueryParams") else { return nil }
    guard let setResponseHeaders = stringMap("setResponseHeaders") else { return nil }
    guard let removeResponseHeaders = stringArray("removeResponseHeaders") else { return nil }

    var status: Int?
    if let rawStatus = obj["status"], !(rawStatus is NSNull) {
        guard let n = rawStatus as? NSNumber else { return nil }
        status = n.intValue
    }

    var replaceBody: [MockRuleModify.BodyReplacement]?
    if let rawReplace = obj["replaceBody"], !(rawReplace is NSNull) {
        guard let arr = rawReplace as? [Any] else { return nil }
        var out: [MockRuleModify.BodyReplacement] = []
        for item in arr {
            guard let entry = asObject(item),
                  let find = entry["find"] as? String,
                  let replace = entry["replace"] as? String
            else { return nil }
            out.append(MockRuleModify.BodyReplacement(find: find, replace: replace))
        }
        replaceBody = out
    }

    return MockRuleModify(
        setRequestHeaders: setRequestHeaders,
        removeRequestHeaders: removeRequestHeaders,
        setQueryParams: setQueryParams,
        removeQueryParams: removeQueryParams,
        status: status,
        setResponseHeaders: setResponseHeaders,
        removeResponseHeaders: removeResponseHeaders,
        replaceBody: replaceBody
    )
}

private func parseMockRuleInput(_ v: Any?) -> (id: String, rule: MockRuleInput)? {
    guard let obj = asObject(v) else { return nil }
    guard let id = obj["id"] as? String, isExternalId(id) else { return nil }
    guard let pattern = obj["pattern"] as? String, !pattern.isEmpty else { return nil }

    var method: String?
    if let rawMethod = obj["method"] {
        guard let m = rawMethod as? String else { return nil }
        method = m
    }

    if let rawMode = obj["mode"] {
        guard let mode = rawMode as? String, mode == "mock" || mode == "rewrite" else { return nil }
    }

    guard let enabled = obj["enabled"] as? Bool else { return nil }

    var redirectTo: String?
    if let rawRedirect = obj["redirectTo"], !(rawRedirect is NSNull) {
        guard let s = rawRedirect as? String else { return nil }
        redirectTo = s
    }

    var block = false
    if let rawBlock = obj["block"], !(rawBlock is NSNull) {
        guard let b = rawBlock as? Bool else { return nil }
        block = b
    }

    var modify: MockRuleModify?
    if let rawModify = obj["modify"], !(rawModify is NSNull) {
        guard let m = parseMockRuleModify(rawModify) else { return nil }
        modify = m
    }

    guard let response = parseMockResponse(obj["response"]) else { return nil }

    let rule = MockRuleInput(
        pattern: pattern,
        isRegex: false,
        regexFlags: nil,
        method: method,
        response: response,
        enabled: enabled,
        redirectTo: redirectTo,
        block: block,
        modify: modify
    )
    return (id, rule)
}

private func parseBreakpointInput(_ v: Any?) -> (id: String, breakpoint: BreakpointInput)? {
    guard let obj = asObject(v) else { return nil }
    guard let id = obj["id"] as? String, isExternalId(id) else { return nil }
    guard let pattern = obj["pattern"] as? String, !pattern.isEmpty else { return nil }

    var method: String?
    if let rawMethod = obj["method"] {
        guard let m = rawMethod as? String else { return nil }
        method = m
    }

    var phase: BreakpointPhase = .request
    if let rawOn = obj["on"] {
        guard let on = rawOn as? String, breakpointPhaseValues.contains(on),
              let parsedPhase = BreakpointPhase(rawValue: on) else { return nil }
        phase = parsedPhase
    }

    guard let enabled = obj["enabled"] as? Bool else { return nil }

    let breakpoint = BreakpointInput(pattern: pattern, method: method, on: phase, enabled: enabled, id: id)
    return (id, breakpoint)
}

// MARK: - parseControlCommand

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

/// Parse a raw JSON text frame's `payload` field directly from `Data`.
/// Convenience wrapper around `parseControlCommand(_:)` for callers that
/// have not yet decoded the frame (e.g. `HakkaBridgeClient`'s receive loop).
public func parseControlCommand(fromPayloadJSON data: Data) -> ControlCommand? {
    guard let obj = try? JSONSerialization.jsonObject(with: data) else { return nil }
    return parseControlCommand(obj)
}

// MARK: - Engine seams (fail-open boundary)
//
// Thin protocols over the three singleton engines. `MockEngine`,
// `BreakpointEngine`, and `ThrottleEngine` conform via the extensions below
// and don't throw today, but `applyControlCommand` still routes every call
// through `applyFailOpen`, which is the actual fail-open boundary: it runs
// the engine call on a protected path and converts any thrown Swift error
// into `.failure(message)` instead of letting it propagate — mirroring the
// try/catch wrapper in `control.ts`'s `applyControlCommand`. Tests exercise
// this boundary with throwing fakes (see `ControlCommandTests`).

public protocol ControlMockEngine {
    func controlAddRule(_ input: MockRuleInput, id: String) throws
    func controlRemoveRule(id: String) throws
    func controlClearRules() throws
}

public protocol ControlBreakpointEngine {
    func controlAddBreakpoint(_ input: BreakpointInput) throws
    func controlRemoveBreakpoint(id: String) throws
}

public protocol ControlThrottleEngine {
    func controlSetProfile(_ profile: ThrottleProfile) throws
    func controlSetCustom(latencyMs: Int, downloadKbps: Int) throws
}

extension MockEngine: ControlMockEngine {
    public func controlAddRule(_ input: MockRuleInput, id: String) throws { addRule(input, id: id) }
    public func controlRemoveRule(id: String) throws { removeRule(id: id) }
    public func controlClearRules() throws { clearRules() }
}

extension BreakpointEngine: ControlBreakpointEngine {
    public func controlAddBreakpoint(_ input: BreakpointInput) throws { addBreakpoint(input) }
    public func controlRemoveBreakpoint(id: String) throws { removeBreakpoint(id: id) }
}

extension ThrottleEngine: ControlThrottleEngine {
    public func controlSetProfile(_ profile: ThrottleProfile) throws { setProfile(profile) }
    public func controlSetCustom(latencyMs: Int, downloadKbps: Int) throws { setCustom(latencyMs: latencyMs, downloadKbps: downloadKbps) }
}

// MARK: - applyControlCommand

public enum ControlApplyResult: Sendable, Equatable {
    case ok
    case failure(String)
}

/// Apply a validated `ControlCommand` to the singleton engines (`MockEngine`,
/// `BreakpointEngine`, `ThrottleEngine`). Every engine call is wrapped in a
/// do/catch — a throw from the engine is reported as `.failure(message)`,
/// never propagated. This is a hard invariant: a malformed or unexpected
/// command must never throw into the host app. Matches
/// `control.ts`'s `applyControlCommand` exactly.
@discardableResult
public func applyControlCommand(
    _ cmd: ControlCommand,
    mockEngine: ControlMockEngine = MockEngine.shared,
    breakpointEngine: ControlBreakpointEngine = BreakpointEngine.shared,
    throttleEngine: ControlThrottleEngine = ThrottleEngine.shared
) -> ControlApplyResult {
    switch cmd {
    case let .mockAdd(id, rule):
        return applyFailOpen { try mockEngine.controlAddRule(rule, id: id) }

    case let .mockRemove(id):
        return applyFailOpen { try mockEngine.controlRemoveRule(id: id) }

    case .mockClear:
        return applyFailOpen { try mockEngine.controlClearRules() }

    case let .breakpointAdd(id, breakpoint):
        // `breakpoint.id` already carries the caller-supplied id (set by
        // `parseBreakpointInput`); `addBreakpoint` replaces any existing
        // rule with that id in place.
        precondition(breakpoint.id == id, "parseBreakpointInput must stamp the external id onto BreakpointInput")
        return applyFailOpen { try breakpointEngine.controlAddBreakpoint(breakpoint) }

    case let .breakpointRemove(id):
        return applyFailOpen { try breakpointEngine.controlRemoveBreakpoint(id: id) }

    case let .throttleSet(profile, latencyMs, downloadKbps):
        return applyFailOpen {
            if profile == .custom {
                try throttleEngine.controlSetCustom(latencyMs: latencyMs ?? 0, downloadKbps: downloadKbps ?? 0)
            } else {
                try throttleEngine.controlSetProfile(profile)
            }
        }
    }
}

/// Runs `body`, catching any thrown Swift error and converting it to
/// `.failure(message)` — the actual fail-open boundary. See the engine-seam
/// docs above for why this is a do/catch over protocol calls rather than a
/// no-op wrapper.
private func applyFailOpen(_ body: () throws -> Void) -> ControlApplyResult {
    do {
        try body()
        return .ok
    } catch {
        return .failure(String(describing: error))
    }
}
