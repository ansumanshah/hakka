import Foundation

/// Runs every conformance check against a fresh runtime from `probe` and
/// returns a report. A conforming `ScriptRuntime` must pass every check
/// here; `ScriptRuntimeConformanceTests` proves both that the JavaScriptCore
/// implementation passes it, and that a deliberately broken fake does not.
public func checkScriptRuntimeConformance(_ probe: ScriptRuntimeConformanceProbe) async -> ScriptRuntimeConformanceReport {
    var checks: [ScriptRuntimeConformanceCheck] = []

    checks.append(await runConformanceCheck("a well-formed script runs and its output is observable") {
        let runtime = probe.makeRuntime()
        let output = try await runtime.run(ScriptInput(
            source: "log('hi'); response.status = 201;",
            response: ScriptResponseContext(status: 200)
        ))
        try assertConformance(output.logs == ["hi"], "expected logs == [\"hi\"], got \(output.logs)")
        try assertConformance(
            output.response?.status == 201,
            "expected mutated response.status == 201, got \(String(describing: output.response?.status))"
        )
    })

    checks.append(await runConformanceCheck(
        "a runaway loop is stopped by the wall-clock timeout, not merely reported",
        hardDeadline: 8
    ) {
        let runtime = probe.makeRuntime()
        let started = Date()
        do {
            _ = try await runtime.run(ScriptInput(source: "while (true) {}", timeout: 0.3))
            throw ScriptRuntimeConformanceFailure("a runaway script returned successfully instead of timing out")
        } catch ScriptError.timeout {
            let elapsed = Date().timeIntervalSince(started)
            try assertConformance(elapsed < 3, "timeout fired \(elapsed)s after a 0.3s budget — too slow to be a real stop")
        }
    })

    checks.append(await runConformanceCheck("filesystem access is absent") {
        let runtime = probe.makeRuntime()
        do {
            _ = try await runtime.run(ScriptInput(source: "require('fs').readFileSync('/etc/passwd');"))
            throw ScriptRuntimeConformanceFailure("a script calling require('fs') completed instead of failing")
        } catch ScriptError.runtimeError {
            // expected: no filesystem capability is installed
        }
    })

    checks.append(await runConformanceCheck("network access is absent") {
        let runtime = probe.makeRuntime()
        do {
            _ = try await runtime.run(ScriptInput(source: "fetch('https://example.com');"))
            throw ScriptRuntimeConformanceFailure("a script calling fetch(...) completed instead of failing")
        } catch ScriptError.runtimeError {
            // expected: no network capability is installed
        }
    })

    checks.append(await runConformanceCheck("script errors surface to the caller rather than being swallowed") {
        let runtime = probe.makeRuntime()
        do {
            _ = try await runtime.run(ScriptInput(source: "throw new Error('boom');"))
            throw ScriptRuntimeConformanceFailure("a throwing script completed instead of failing")
        } catch ScriptError.runtimeError(let message) {
            try assertConformance(message.contains("boom"), "expected the thrown message to surface, got \(message)")
        }
    })

    checks.append(await runConformanceCheck("one script cannot see state left by another") {
        let runtime = probe.makeRuntime()
        _ = try await runtime.run(ScriptInput(source: "globalThis.leaked = 'visible';"))
        let output = try await runtime.run(ScriptInput(source: "log(typeof leaked);"))
        try assertConformance(
            output.logs == ["undefined"],
            "second script observed \(output.logs) instead of [\"undefined\"] — state leaked across runs"
        )
    })

    checks.append(await runConformanceCheck("concurrent runs on the same runtime do not corrupt each other") {
        let runtime = probe.makeRuntime()
        async let first = runtime.run(ScriptInput(source: "log('first');"))
        async let second = runtime.run(ScriptInput(source: "log('second');"))
        let (a, b) = try await (first, second)
        try assertConformance(a.logs == ["first"], "expected [\"first\"], got \(a.logs)")
        try assertConformance(b.logs == ["second"], "expected [\"second\"], got \(b.logs)")
    })

    return ScriptRuntimeConformanceReport(checks: checks)
}
