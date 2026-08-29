import Foundation
import Testing
@testable import HakkaCore

/// Sandbox-property tests that are best read individually rather than
/// folded into the generic harness: each one is here because it needed a
/// specific, hand-picked assertion to be convincing (measuring elapsed
/// time, proving isolation across two calls, racing two calls at once).
@Suite("JavaScriptCoreScriptRuntime sandbox properties")
struct ScriptRuntimeSandboxTests {
    @Test("a runaway loop is actually stopped: elapsed time tracks the timeout, not the loop")
    func runawayLoopStopsAtTheTimeout() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        let started = Date()
        await #expect(throws: ScriptError.timeout) {
            _ = try await runtime.run(ScriptInput(source: "var i = 0; while (true) { i++; }", timeout: 0.25))
        }
        let elapsed = Date().timeIntervalSince(started)
        // A merely-reported timeout (one that keeps the loop running in the
        // background and just gives up waiting) would still return quickly
        // here, so this alone isn't the whole proof — see
        // `aSecondScriptRunsPromptlyAfterATimeout` for the other half.
        //
        // Budget note: the two outcomes are far apart, not close. A working
        // timeout returns in about 0.25s; a broken one never returns at all.
        // The bound only has to sit somewhere in that gulf, so it is set wide
        // rather than snug. It was 2s, which a loaded machine tripped at 2.19s
        // inside the parallel `just verify` gate, reporting a sandbox failure
        // that did not exist. A wall-clock assertion that only CPU contention
        // can trip is worse than none: it trains you to ignore the gate.
        #expect(elapsed < 15, "took \(elapsed)s to report a 0.25s timeout")
    }

    @Test("after a timeout, a second script runs promptly — the first one is not still holding a thread")
    func aSecondScriptRunsPromptlyAfterATimeout() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        await #expect(throws: ScriptError.timeout) {
            _ = try await runtime.run(ScriptInput(source: "while (true) {}", timeout: 0.2))
        }
        let started = Date()
        let output = try await runtime.run(ScriptInput(source: "log('still alive');", timeout: 5))
        let elapsed = Date().timeIntervalSince(started)
        #expect(output.logs == ["still alive"])
        // Same budget reasoning as `runawayLoopStopsAtTheTimeout` above: if the
        // first script were still holding the thread, this would block for its
        // full duration or forever, not for a second and a bit. Wide bound so
        // only that real failure can trip it, never gate contention.
        #expect(elapsed < 10, "second script took \(elapsed)s to start — first one may still be running")
    }

    @Test("a script that throws surfaces the message, not a swallowed success")
    func thrownErrorSurfaces() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        await #expect(throws: ScriptError.self) {
            _ = try await runtime.run(ScriptInput(source: "throw new Error('signature mismatch');"))
        }
        do {
            _ = try await runtime.run(ScriptInput(source: "throw new Error('signature mismatch');"))
            Issue.record("expected the run to throw")
        } catch ScriptError.runtimeError(let message) {
            #expect(message.contains("signature mismatch"))
        }
    }

    @Test("a syntax error surfaces as a runtime error, not a silent no-op")
    func syntaxErrorSurfaces() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        await #expect(throws: ScriptError.self) {
            _ = try await runtime.run(ScriptInput(source: "this is not valid javascript ;;;"))
        }
    }

    @Test("two runs on the same runtime instance are fully isolated")
    func runsAreIsolated() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        _ = try await runtime.run(ScriptInput(source: "globalThis.secret = 'from-first-script';"))
        let output = try await runtime.run(ScriptInput(source: "log(typeof secret);"))
        #expect(output.logs == ["undefined"])
    }

    @Test("many concurrent runs on the same runtime instance stay independent")
    func manyConcurrentRunsStayIndependent() async throws {
        let runtime = JavaScriptCoreScriptRuntime()
        let results = try await withThrowingTaskGroup(of: (Int, [String]).self) { group in
            for i in 0..<8 {
                group.addTask {
                    let output = try await runtime.run(ScriptInput(source: "log(String(\(i)));"))
                    return (i, output.logs)
                }
            }
            var collected: [Int: [String]] = [:]
            for try await (i, logs) in group { collected[i] = logs }
            return collected
        }
        for i in 0..<8 {
            #expect(results[i] == [String(i)], "index \(i) saw \(String(describing: results[i]))")
        }
    }
}

/// The double-resume/reentrancy guard is exercised directly, decoupled from
/// JSC timing, so this test is deterministic rather than racy.
@Suite("ScriptExecutionCompletionGuard")
struct ScriptExecutionCompletionGuardTests {
    @Test("only the first of several fire attempts wins")
    func onlyFirstFireWins() {
        let guardBox = ScriptExecutionCompletionGuard()
        let outcomes = (0..<5).map { _ in guardBox.tryFire() }
        #expect(outcomes == [true, false, false, false, false])
    }

    @Test("concurrent fire attempts still let exactly one through")
    func concurrentFireAttemptsYieldExactlyOneWinner() async {
        let guardBox = ScriptExecutionCompletionGuard()
        let winners = await withTaskGroup(of: Bool.self) { group in
            for _ in 0..<50 {
                group.addTask { guardBox.tryFire() }
            }
            var wins = 0
            for await won in group where won { wins += 1 }
            return wins
        }
        #expect(winners == 1)
    }
}
