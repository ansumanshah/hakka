import Foundation
import Testing
@testable import HakkaCommon

// MARK: - ControlCommand — mock.add failure/skipCount/stopAfter
//
// Split out of ControlCommandTests.swift to keep files under 200 lines.
// Mirrors the equivalent cases in
// `packages/hakka-core/src/engine/__tests__/control.test.ts`.

@Suite("ControlCommand — mock.add failure/skipCount/stopAfter", .serialized)
struct ControlCommandMockSkipStopFailureTests {

    private func freshEngines() -> (MockEngine, BreakpointEngine, ThrottleEngine) {
        (MockEngine(), BreakpointEngine(), ThrottleEngine())
    }

    // MARK: - parse: pinned fixtures (shared with TS/Kotlin — see fixtures/control/README.md)

    @Test func parsesFailureFixture() throws {
        let raw = try ControlFixtures.readJSON("mock-add-failure.json")
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(id, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(id == "mck-flaky")
        #expect(rule.pattern == "/api/checkout")
        #expect(rule.failure?.code == .cannotConnectToHost)
        #expect(rule.skipCount == 0)
        #expect(rule.stopAfter == nil)
    }

    @Test func parsesSkipStopFixture() throws {
        let raw = try ControlFixtures.readJSON("mock-add-skip-stop.json")
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(id, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(id == "mck-retry")
        #expect(rule.pattern == "/api/retry")
        #expect(rule.skipCount == 2)
        #expect(rule.stopAfter == 3)
        #expect(rule.failure == nil)
    }

    @Test func parsesHeaderValuesFixture() throws {
        let raw = try ControlFixtures.readJSON("mock-add-header-values.json")
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(id, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(id == "mck-login")
        #expect(rule.pattern == "/api/login")
        #expect(rule.response.headers["Set-Cookie"] == "session=abc; Path=/")
        #expect(rule.response.headerValues["Set-Cookie"] == ["session=abc; Path=/", "consent=yes; Path=/"])
    }

    // MARK: - parse: valid shapes

    @Test func parsesFailureBlock() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-fail-1",
                "pattern": "/api/flaky",
                "enabled": true,
                "failure": ["code": "timeout"],
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(rule.failure?.code == .timeout)
    }

    @Test func parsesEveryFailureCode() {
        for code in MockFailureCode.allCases {
            let raw: [String: Any] = [
                "kind": "mock.add",
                "rule": [
                    "id": "rule-\(code.rawValue)",
                    "pattern": "/x",
                    "enabled": true,
                    "failure": ["code": code.rawValue],
                    "response": ["status": 200, "body": "{}"],
                ],
            ]
            let cmd = parseControlCommand(raw)
            guard case let .mockAdd(_, rule) = cmd else {
                Issue.record("expected .mockAdd for code \(code.rawValue)")
                continue
            }
            #expect(rule.failure?.code == code)
        }
    }

    @Test func parsesSkipCountAndStopAfter() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-skip-stop",
                "pattern": "/api/retry",
                "enabled": true,
                "skipCount": 2,
                "stopAfter": 3,
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(rule.skipCount == 2)
        #expect(rule.stopAfter == 3)
    }

    @Test func skipCountAndStopAfterDefaultToZeroAndNil() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "rule-bare", "pattern": "/x", "enabled": true, "response": ["status": 200, "body": "{}"]],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(rule.skipCount == 0)
        #expect(rule.stopAfter == nil)
        #expect(rule.failure == nil)
    }

    @Test func skipCountZeroAndStopAfterZeroAreExplicitlyValid() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-zero",
                "pattern": "/x",
                "enabled": true,
                "skipCount": 0,
                "stopAfter": 0,
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(rule.skipCount == 0)
        #expect(rule.stopAfter == 0)
    }

    // MARK: - parse: hostile / malformed

    @Test func rejectsFailureNotAnObject() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "a", "pattern": "x", "enabled": true, "failure": "nope", "response": ["status": 200, "body": ""]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsFailureMissingCode() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "a", "pattern": "x", "enabled": true, "failure": [:], "response": ["status": 200, "body": ""]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsFailureUnknownCode() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "a", "pattern": "x", "enabled": true,
                "failure": ["code": "meteorStrike"],
                "response": ["status": 200, "body": ""],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsNegativeSkipCount() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "a", "pattern": "x", "enabled": true, "skipCount": -1, "response": ["status": 200, "body": ""]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsNonIntegerSkipCount() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "a", "pattern": "x", "enabled": true, "skipCount": 1.5, "response": ["status": 200, "body": ""]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsWrongTypeSkipCount() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "a", "pattern": "x", "enabled": true, "skipCount": "3", "response": ["status": 200, "body": ""]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsNegativeStopAfter() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "a", "pattern": "x", "enabled": true, "stopAfter": -1, "response": ["status": 200, "body": ""]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsNonFiniteStopAfter() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "a", "pattern": "x", "enabled": true,
                "stopAfter": Double.infinity,
                "response": ["status": 200, "body": ""],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBooleanMasqueradingAsSkipCount() {
        // NSNumber wraps Bool too — must not silently accept `true`/`false` as 1/0.
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "a", "pattern": "x", "enabled": true, "skipCount": true, "response": ["status": 200, "body": ""]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    // MARK: - apply: reaches the engine with the exact fields set

    @Test func applyingMockAddWithFailureAndSkipStopReachesTheEngine() {
        let (mock, bp, throttle) = freshEngines()
        let cmd = parseControlCommand([
            "kind": "mock.add",
            "rule": [
                "id": "r1", "pattern": "/api", "enabled": true,
                "failure": ["code": "cannotConnectToHost"],
                "skipCount": 1,
                "stopAfter": 2,
                "response": ["status": 200, "body": "{}"],
            ],
        ])!
        applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)

        let rule = mock.getRules().first
        #expect(rule?.failure?.code == .cannotConnectToHost)
        #expect(rule?.skipCount == 1)
        #expect(rule?.stopAfter == 2)

        // And the budget actually governs matching through this same engine instance.
        #expect(mock.match(url: "https://example.com/api", method: "GET") == nil) // skipped
        #expect(mock.match(url: "https://example.com/api", method: "GET")?.failure?.code == .cannotConnectToHost)
        #expect(mock.match(url: "https://example.com/api", method: "GET")?.failure?.code == .cannotConnectToHost)
        #expect(mock.match(url: "https://example.com/api", method: "GET") == nil) // exhausted
    }
}
