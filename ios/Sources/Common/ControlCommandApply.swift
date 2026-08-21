import Foundation

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
    /// Releases a pause. `PausedRequest`/`PausedResponse` (the local engine's
    /// types) are full replacements, not partial edits — the wire's
    /// `BreakpointRequestEdits`/`BreakpointResponseEdits` are partial
    /// (`Partial<PausedRequest>` on the TS side), so the conformance below
    /// merges each provided field over the pause's own original snapshot
    /// (from `getPaused()`) before calling the engine's `resume`/
    /// `resumeResponse`, matching how `control.ts`'s `decideBreakpointRequest`
    /// merges `edits.url ?? request.url` etc.
    func controlResumeBreakpoint(pauseId: String, requestEdits: BreakpointRequestEdits?, responseEdits: BreakpointResponseEdits?) throws
    func controlAbortBreakpoint(pauseId: String) throws
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

    public func controlResumeBreakpoint(pauseId: String, requestEdits: BreakpointRequestEdits?, responseEdits: BreakpointResponseEdits?) throws {
        // An unknown pauseId is a silent no-op — mirrors the TS engine's
        // `resume()`, which just returns when `pending.get(pauseId)` misses.
        guard let entry = getPaused().first(where: { $0.id == pauseId }) else { return }

        switch entry {
        case .request(_, _, let original):
            let merged = PausedRequest(
                url: requestEdits?.url ?? original.url,
                method: requestEdits?.method ?? original.method,
                headers: requestEdits?.headers ?? original.headers,
                body: requestEdits?.body ?? original.body
            )
            resume(pauseId: pauseId, requestEdits: merged)
        case .response(_, _, let original):
            let merged = PausedResponse(
                status: responseEdits?.status ?? original.status,
                headers: responseEdits?.headers ?? original.headers,
                body: responseEdits?.body ?? original.body
            )
            resumeResponse(pauseId: pauseId, responseEdits: merged)
        }
    }

    public func controlAbortBreakpoint(pauseId: String) throws { abort(pauseId: pauseId) }
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
/// `control.ts`'s `applyControlCommand` exactly. The switch has no `default`
/// case — a new `ControlCommand` kind must be handled here explicitly.
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

    case .breakpointPaused:
        // Device-to-host only (see `isDeviceToHostCommand`) — a device
        // applying its own pause notification is a protocol bug, not
        // something to silently no-op. Still must never throw.
        return .failure("breakpoint.paused travels device to host only; a device must never apply it")

    case let .breakpointResume(pauseId, requestEdits, responseEdits):
        return applyFailOpen {
            try breakpointEngine.controlResumeBreakpoint(pauseId: pauseId, requestEdits: requestEdits, responseEdits: responseEdits)
        }

    case let .breakpointAbort(pauseId):
        return applyFailOpen { try breakpointEngine.controlAbortBreakpoint(pauseId: pauseId) }

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
