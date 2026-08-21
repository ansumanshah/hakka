import Foundation

/// How a conformance run obtains the implementation under test. Each check
/// asks for a fresh runtime, so one check's misbehavior (a runtime that
/// corrupts its own state on a bad script, say) can never contaminate
/// another check's result.
public protocol ScriptRuntimeConformanceProbe: Sendable {
    func makeRuntime() -> any ScriptRuntime
}

/// One named assertion's outcome.
public struct ScriptRuntimeConformanceCheck: Sendable, Equatable {
    public let name: String
    public let passed: Bool
    /// Present only when `passed` is false.
    public let detail: String?

    public init(name: String, passed: Bool, detail: String? = nil) {
        self.name = name
        self.passed = passed
        self.detail = detail
    }
}

/// The full result of a conformance run.
public struct ScriptRuntimeConformanceReport: Sendable, Equatable {
    public let passed: Bool
    public let checks: [ScriptRuntimeConformanceCheck]

    public init(checks: [ScriptRuntimeConformanceCheck]) {
        self.checks = checks
        self.passed = checks.allSatisfy(\.passed)
    }
}

struct ScriptRuntimeConformanceFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

/// A check that never trusts the runtime under test to return. Races
/// `body` against `hardDeadline`; a runtime that hangs past its own
/// declared timeout fails the check with a clear reason instead of hanging
/// the whole conformance run (and the test suite with it) forever. This is
/// what lets the harness be run against a genuinely broken implementation
/// safely.
func runConformanceCheck(
    _ name: String,
    hardDeadline: TimeInterval = 10,
    _ body: @escaping @Sendable () async throws -> Void
) async -> ScriptRuntimeConformanceCheck {
    do {
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { try await body() }
            group.addTask {
                try await Task.sleep(for: .seconds(hardDeadline))
                throw ScriptRuntimeConformanceFailure(
                    "did not return within the \(hardDeadline)s hard deadline — timeout not enforced"
                )
            }
            try await group.next()
            group.cancelAll()
        }
        return ScriptRuntimeConformanceCheck(name: name, passed: true)
    } catch {
        return ScriptRuntimeConformanceCheck(name: name, passed: false, detail: String(describing: error))
    }
}

func assertConformance(_ condition: Bool, _ message: @autoclosure () -> String) throws {
    if !condition { throw ScriptRuntimeConformanceFailure(message()) }
}
