import Foundation
import Testing
@testable import HakkaCore

/// Proves the harness itself is honest: it must pass the real
/// implementation and fail a deliberately broken one. A conformance
/// harness that passes everything given to it is worthless — this is the
/// test that rules that out.
@Suite("ScriptRuntime conformance")
struct ScriptRuntimeConformanceTests {
    private struct JavaScriptCoreProbe: ScriptRuntimeConformanceProbe {
        func makeRuntime() -> any ScriptRuntime { JavaScriptCoreScriptRuntime() }
    }

    private struct BrokenProbe: ScriptRuntimeConformanceProbe {
        func makeRuntime() -> any ScriptRuntime { BrokenScriptRuntime() }
    }

    @Test("the JavaScriptCore implementation passes every check")
    func javaScriptCoreImplementationConforms() async throws {
        let report = await checkScriptRuntimeConformance(JavaScriptCoreProbe())
        let failures = report.checks.filter { !$0.passed }
        #expect(failures.isEmpty, "unexpected failures: \(failures)")
        #expect(report.passed)
    }

    @Test("a deliberately broken fake fails the harness")
    func brokenFakeFailsConformance() async throws {
        let report = await checkScriptRuntimeConformance(BrokenProbe())
        #expect(!report.passed)

        let byName = Dictionary(uniqueKeysWithValues: report.checks.map { ($0.name, $0.passed) })
        #expect(byName["a runaway loop is stopped by the wall-clock timeout, not merely reported"] == false)
        #expect(byName["filesystem access is absent"] == false)
        #expect(byName["network access is absent"] == false)
        #expect(byName["script errors surface to the caller rather than being swallowed"] == false)
        #expect(byName["one script cannot see state left by another"] == false)

        // The one check a broken-but-not-malicious fake can still pass by
        // accident, proving the harness doesn't just fail everything.
        #expect(byName["a well-formed script runs and its output is observable"] == true)
    }
}

/// A `ScriptRuntime` that gets almost everything wrong on purpose: it
/// ignores the timeout, "succeeds" at filesystem/network calls instead of
/// rejecting them, swallows thrown errors instead of surfacing them, and
/// shares one mutable dictionary as global state across every call. Used
/// only to prove `checkScriptRuntimeConformance` can actually fail.
private final class BrokenScriptRuntime: ScriptRuntime {
    private let sharedState = LockedBox()

    func run(_ input: ScriptInput) async throws -> ScriptOutput {
        if input.source.contains("while (true)") {
            // Pretends the timeout never happened.
            return ScriptOutput(logs: ["ran forever, allegedly"])
        }
        if input.source.contains("require(") || input.source.contains("fetch(") {
            // Pretends filesystem/network calls succeeded.
            return ScriptOutput(logs: ["it worked, trust me"])
        }
        if input.source.contains("throw new Error") {
            // Swallows the error instead of surfacing it.
            return ScriptOutput(logs: [])
        }
        if input.source.contains("globalThis.leaked") {
            sharedState.set("visible")
            return ScriptOutput()
        }
        if input.source.contains("typeof leaked") {
            // Leaks state across calls instead of isolating each script.
            return ScriptOutput(logs: [sharedState.get() ?? "undefined"])
        }
        return ScriptOutput(
            response: input.response.map { ScriptResponseContext(status: 201, headers: $0.headers, body: $0.body) },
            logs: ["hi"]
        )
    }
}

private final class LockedBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?

    func set(_ newValue: String) {
        lock.lock(); defer { lock.unlock() }
        value = newValue
    }

    func get() -> String? {
        lock.lock(); defer { lock.unlock() }
        return value
    }
}
