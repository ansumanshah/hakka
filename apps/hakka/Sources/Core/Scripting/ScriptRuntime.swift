import Foundation

/// Runs one user-authored script in an isolated, sandboxed execution
/// context and reports what it did.
///
/// `@experimental` — ADR 0009's rule of three. This contract has one
/// consumer today (`JavaScriptCoreScriptRuntime`, checked by
/// `checkScriptRuntimeConformance`); it stays `@experimental` and unfrozen
/// until a third, genuinely independent consumer exists, per ADR 0010
/// sub-decision 3.
///
/// The contract exists so the sandbox bar is testable, not aspirational
/// (ADR 0010): every conforming implementation is required, not merely
/// encouraged, to enforce a wall-clock timeout that actually stops a
/// runaway script, to expose no filesystem or network capability, to
/// surface script errors to the caller instead of swallowing them, and to
/// give each script its own isolated state. `checkScriptRuntimeConformance`
/// in `ScriptRuntimeConformance.swift` is the runnable proof; a
/// deliberately broken fake implementation is required to fail it
/// (`ScriptRuntimeConformanceTests` runs one).
///
/// The API surface a script sees is deliberately small by design, not by
/// omission: `env`, `log`, and request/response mutation. No `require`, no
/// npm resolution, no filesystem, no network. This is the shape Proxyman's
/// broad scripting API did not have, and the support burden that caused is
/// the failure mode this contract exists to avoid.
///
/// This file defines the contract only. Wiring scripts into requests, the
/// collection file format, or a script editor is out of scope here — see
/// ADR 0010 phase 4.2 through 4.4.
public protocol ScriptRuntime: Sendable {
    /// Executes `input.source` to completion in a context that has never
    /// seen any other script, and never will again — see `ScriptInput`.
    /// Throws `ScriptError.timeout` if the wall-clock budget in
    /// `input.timeout` is exceeded, or `ScriptError.runtimeError` if the
    /// script itself threw or failed to parse. Never returns a success
    /// value for a script that did either.
    func run(_ input: ScriptInput) async throws -> ScriptOutput
}
