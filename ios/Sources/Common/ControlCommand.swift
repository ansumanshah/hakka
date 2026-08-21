import Foundation

// MARK: - ControlCommand
//
// Swift mirror of the control-channel contract in
// `packages/hakka-core/src/engine/control.ts` — the source of truth; read it
// first. A bridge peer (e.g. the MCP server, or a paused device) may send a
// JSON text frame:
// ```json
// { "type": "control", "payload": <ControlCommand> }
// ```
// over the same WebSocket used to stream captures. `parseControlCommand`
// (in `ControlCommandParsing.swift`) validates an untyped payload into a
// `ControlCommand` — strict shape checking, never throws, returns `nil` on
// anything malformed. `applyControlCommand` (in `ControlCommandApply.swift`)
// drives the singleton engines (`MockEngine`, `BreakpointEngine`,
// `ThrottleEngine`). It is fail-open: any engine-call exception is caught
// and reported as `.failure(message)` — a malformed or unexpected command
// must never propagate into the host app.
//
// Id semantics: ids for `mock.add` / `breakpoint.add` are minted by the
// remote caller, not generated locally, so that peer can later remove the
// same rule cross-process. `MockEngine.addRule(_:id:)` /
// `BreakpointEngine.addBreakpoint(_:)` honor a caller-supplied id, replacing
// any existing rule/breakpoint with the same id in place (replace-by-id)
// rather than rejecting the add or creating a duplicate. Pause ids
// (`breakpoint.paused`/`.resume`/`.abort`) are minted by the pausing device
// and are NOT charset-restricted the way `mock.add`/`breakpoint.add` ids are
// — see `ControlCommandParsingBreakpoint.swift`.
//
// Direction: every kind except `breakpoint.paused` travels host -> device.
// `breakpoint.paused` travels device -> host only — a host encoder must
// refuse to emit it (see `ControlCommandEncoder` in the desktop app) and a
// device's `applyControlCommand` must refuse to apply one (a device
// "applying" its own pause notification is a protocol bug).
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
let externalIdPattern = "^[A-Za-z0-9_-]{1,64}$"

func isExternalId(_ s: String) -> Bool {
    guard !s.isEmpty, s.utf8.count <= 64 else { return false }
    return s.range(of: externalIdPattern, options: .regularExpression) != nil
}

/// Pause ids are minted by the pausing device, not charset-restricted like
/// external ids (a device may quote its own ids however it likes) — just
/// bounded so a hostile peer can't wedge a huge string into engine state.
let maxPauseIdLength = 256
let maxDeviceLength = 256

func isPauseId(_ s: String) -> Bool {
    !s.isEmpty && s.utf8.count <= maxPauseIdLength
}

let throttleProfileValues: Set<String> = ["none", "fast-3g", "slow-3g", "offline", "edge", "custom"]
let breakpointPhaseValues: Set<String> = ["request", "response", "both"]
/// A live pause is always at one concrete phase — never `both` (that's a rule-matching concept, not a paused-entry one).
let pausePhaseValues: Set<String> = ["request", "response"]

// MARK: - ControlCommand

public enum ControlCommand: Sendable, Equatable {
    case mockAdd(id: String, rule: MockRuleInput)
    case mockRemove(id: String)
    case mockClear
    case breakpointAdd(id: String, breakpoint: BreakpointInput)
    case breakpointRemove(id: String)
    /// Device -> host only. See the direction note above.
    case breakpointPaused(
        pauseId: String,
        ruleId: String?,
        phase: BreakpointPhase,
        device: String,
        request: BreakpointPausedRequestSnapshot,
        response: BreakpointPausedResponseSnapshot?
    )
    /// Host -> device. Releases a pause, optionally with edits matching the pause's own phase.
    case breakpointResume(pauseId: String, requestEdits: BreakpointRequestEdits?, responseEdits: BreakpointResponseEdits?)
    /// Host -> device.
    case breakpointAbort(pauseId: String)
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
            && lhs.failure == rhs.failure
            && lhs.skipCount == rhs.skipCount
            && lhs.stopAfter == rhs.stopAfter
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

/// `breakpoint.paused` is the one command kind that travels device -> host;
/// every other kind travels host -> device. This is the single source of
/// truth for that split — `ControlCommandEncoder` (the desktop app's
/// host-side send seam) refuses to encode a command this returns `true` for.
public func isDeviceToHostCommand(_ cmd: ControlCommand) -> Bool {
    if case .breakpointPaused = cmd { return true }
    return false
}
