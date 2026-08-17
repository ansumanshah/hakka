import Foundation
import Testing
@testable import HakkaCommon

// MARK: - ControlCommand Tests
//
// Mirrors `packages/hakka-core/src/engine/control.ts`'s test surface: valid parse
// per kind, malformed/hostile-id drops, apply -> engine assertions,
// replace-by-id, and the fail-open guarantee (an engine throw must never
// propagate out of `applyControlCommand`).

@Suite("ControlCommand", .serialized)
struct ControlCommandTests {

    // MARK: - Helpers

    private func freshEngines() -> (MockEngine, BreakpointEngine, ThrottleEngine) {
        (MockEngine(), BreakpointEngine(), ThrottleEngine())
    }

    // MARK: - parse: mock.add

    @Test func parsesValidMockAdd() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-1",
                "pattern": "/api/users",
                "enabled": true,
                "response": ["status": 200, "body": "[]"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(id, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(id == "rule-1")
        #expect(rule.pattern == "/api/users")
        #expect(rule.enabled == true)
        #expect(rule.response.status == 200)
        #expect(rule.response.body == "[]")
    }

    @Test func parsesMockAddWithHeadersMethodAndDelay() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-2",
                "pattern": "/api/posts",
                "method": "POST",
                "enabled": false,
                "response": [
                    "status": 201,
                    "headers": ["Content-Type": "application/json"],
                    "body": "{\"ok\":true}",
                    "delay": 250,
                ],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(id, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(id == "rule-2")
        #expect(rule.method == "POST")
        #expect(rule.enabled == false)
        #expect(rule.response.status == 201)
        #expect(rule.response.headers["Content-Type"] == "application/json")
        #expect(rule.response.body == "{\"ok\":true}")
        #expect(rule.response.delay == 0.25)
    }

    @Test func parsesMockAddWithObjectBody() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-3",
                "pattern": "/api/obj",
                "enabled": true,
                "response": ["status": 200, "body": ["ok": true]],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(rule.response.body?.contains("ok") == true)
    }

    @Test func mockAddAcceptsModeAndAppliesRedirectToAndBlock() {
        // `mode` is accepted for wire-shape compatibility but has no native
        // effect (iOS has no rewriteRequest/rewriteResponse functions) —
        // redirectTo/block DO make it into MockRuleInput and are applied.
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-4",
                "pattern": "/api/rewrite",
                "enabled": true,
                "mode": "rewrite",
                "redirectTo": "https://example.com/other",
                "block": false,
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(id, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(id == "rule-4")
        #expect(rule.redirectTo == "https://example.com/other")
        #expect(rule.block == false)
    }

    @Test func mockAddParsesAndAppliesBlockTrue() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-4b",
                "pattern": "/api/blocked",
                "enabled": true,
                "block": true,
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(rule.block == true)
    }

    @Test func mockAddParsesAndAppliesModify() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-modify",
                "pattern": "/api/modify",
                "enabled": true,
                "modify": [
                    "setRequestHeaders": ["X-A": "1"],
                    "removeRequestHeaders": ["X-B"],
                    "setQueryParams": ["q": "1"],
                    "removeQueryParams": ["r"],
                    "status": 201,
                    "setResponseHeaders": ["X-C": "2"],
                    "removeResponseHeaders": ["X-D"],
                    "replaceBody": [["find": "a", "replace": "b"]],
                ],
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        let modify = try? #require(rule.modify)
        #expect(modify?.setRequestHeaders?["X-A"] == "1")
        #expect(modify?.removeRequestHeaders == ["X-B"])
        #expect(modify?.setQueryParams?["q"] == "1")
        #expect(modify?.removeQueryParams == ["r"])
        #expect(modify?.status == 201)
        #expect(modify?.setResponseHeaders?["X-C"] == "2")
        #expect(modify?.removeResponseHeaders == ["X-D"])
        #expect(modify?.replaceBody?.first?.find == "a")
        #expect(modify?.replaceBody?.first?.replace == "b")
    }

    @Test func mockAddWithEmptyModifyBlockParsesToEmptyModify() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-modify-empty",
                "pattern": "/api/modify-empty",
                "enabled": true,
                "modify": [String: Any](),
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .mockAdd(_, rule) = cmd else {
            Issue.record("expected .mockAdd, got \(String(describing: cmd))")
            return
        }
        #expect(rule.modify != nil)
    }

    @Test func rejectsMockAddWithMalformedModifySetRequestHeaders() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-modify-bad",
                "pattern": "/api",
                "enabled": true,
                "modify": ["setRequestHeaders": ["X-A": 1]], // not a string value
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsMockAddWithMalformedModifyReplaceBody() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-modify-bad-2",
                "pattern": "/api",
                "enabled": true,
                "modify": ["replaceBody": [["find": "a"]]], // missing "replace"
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsMockAddWithNonObjectModify() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-modify-bad-3",
                "pattern": "/api",
                "enabled": true,
                "modify": "not-an-object",
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsMockAddWithNonStringRedirectTo() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-bad-redirect",
                "pattern": "/api",
                "enabled": true,
                "redirectTo": 123,
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsMockAddWithNonBoolBlock() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-bad-block",
                "pattern": "/api",
                "enabled": true,
                "block": "yes",
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsMockAddWithInvalidMode() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-5",
                "pattern": "/api",
                "enabled": true,
                "mode": "not-a-real-mode",
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsMockAddMissingRequiredFields() {
        #expect(parseControlCommand(["kind": "mock.add", "rule": ["id": "x"]]) == nil)
        #expect(parseControlCommand([
            "kind": "mock.add",
            "rule": ["id": "x", "pattern": "/a", "enabled": true],
        ]) == nil) // missing response
        #expect(parseControlCommand([
            "kind": "mock.add",
            "rule": ["id": "x", "pattern": "", "enabled": true, "response": ["status": 200, "body": "{}"]],
        ]) == nil) // empty pattern
    }

    @Test func rejectsMockAddWithNonStringMethod() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": [
                "id": "rule-6",
                "pattern": "/a",
                "enabled": true,
                "method": 123,
                "response": ["status": 200, "body": "{}"],
            ],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    // MARK: - parse: mock.remove / mock.clear

    @Test func parsesValidMockRemove() {
        let cmd = parseControlCommand(["kind": "mock.remove", "id": "rule-1"])
        guard case let .mockRemove(id) = cmd else {
            Issue.record("expected .mockRemove, got \(String(describing: cmd))")
            return
        }
        #expect(id == "rule-1")
    }

    @Test func parsesValidMockClear() {
        let cmd = parseControlCommand(["kind": "mock.clear"])
        #expect(cmd == .mockClear)
    }

    // MARK: - parse: breakpoint.add / remove

    @Test func parsesValidBreakpointAdd() {
        let raw: [String: Any] = [
            "kind": "breakpoint.add",
            "breakpoint": [
                "id": "bp-1",
                "pattern": "/api/slow",
                "on": "response",
                "enabled": true,
            ],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .breakpointAdd(id, bp) = cmd else {
            Issue.record("expected .breakpointAdd, got \(String(describing: cmd))")
            return
        }
        #expect(id == "bp-1")
        #expect(bp.pattern == "/api/slow")
        #expect(bp.on == .response)
        #expect(bp.enabled == true)
        #expect(bp.id == "bp-1")
    }

    @Test func breakpointAddDefaultsPhaseToRequest() {
        let raw: [String: Any] = [
            "kind": "breakpoint.add",
            "breakpoint": ["id": "bp-2", "pattern": "/api", "enabled": true],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .breakpointAdd(_, bp) = cmd else {
            Issue.record("expected .breakpointAdd, got \(String(describing: cmd))")
            return
        }
        #expect(bp.on == .request)
    }

    @Test func rejectsBreakpointAddWithInvalidPhase() {
        let raw: [String: Any] = [
            "kind": "breakpoint.add",
            "breakpoint": ["id": "bp-3", "pattern": "/api", "on": "sometime", "enabled": true],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func parsesValidBreakpointRemove() {
        let cmd = parseControlCommand(["kind": "breakpoint.remove", "id": "bp-1"])
        guard case let .breakpointRemove(id) = cmd else {
            Issue.record("expected .breakpointRemove, got \(String(describing: cmd))")
            return
        }
        #expect(id == "bp-1")
    }

    // MARK: - parse: throttle.set

    @Test func parsesValidThrottleSetPreset() {
        let cmd = parseControlCommand(["kind": "throttle.set", "profile": "slow-3g"])
        guard case let .throttleSet(profile, latencyMs, downloadKbps) = cmd else {
            Issue.record("expected .throttleSet, got \(String(describing: cmd))")
            return
        }
        #expect(profile == .slow3g)
        #expect(latencyMs == nil)
        #expect(downloadKbps == nil)
    }

    @Test func parsesValidThrottleSetCustom() {
        let raw: [String: Any] = ["kind": "throttle.set", "profile": "custom", "latencyMs": 123, "downloadKbps": 456]
        let cmd = parseControlCommand(raw)
        guard case let .throttleSet(profile, latencyMs, downloadKbps) = cmd else {
            Issue.record("expected .throttleSet, got \(String(describing: cmd))")
            return
        }
        #expect(profile == .custom)
        #expect(latencyMs == 123)
        #expect(downloadKbps == 456)
    }

    @Test func rejectsThrottleSetWithUnknownProfile() {
        #expect(parseControlCommand(["kind": "throttle.set", "profile": "5g"]) == nil)
    }

    @Test func rejectsThrottleSetWithNegativeLatency() {
        let raw: [String: Any] = ["kind": "throttle.set", "profile": "custom", "latencyMs": -5]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsThrottleSetWithNonNumericLatency() {
        let raw: [String: Any] = ["kind": "throttle.set", "profile": "custom", "latencyMs": "fast"]
        #expect(parseControlCommand(raw) == nil)
    }

    // MARK: - parse: malformed / unknown kind — drop silently

    @Test func rejectsUnknownKind() {
        #expect(parseControlCommand(["kind": "reboot.device"]) == nil)
    }

    @Test func rejectsMissingKind() {
        #expect(parseControlCommand(["id": "x"]) == nil)
    }

    @Test func rejectsNonObjectPayload() {
        #expect(parseControlCommand("just a string" as Any) == nil)
        #expect(parseControlCommand(42 as Any) == nil)
        #expect(parseControlCommand([1, 2, 3] as Any) == nil)
        #expect(parseControlCommand(nil) == nil)
    }

    @Test func rejectsKindThatIsNotAString() {
        #expect(parseControlCommand(["kind": 5]) == nil)
    }

    // MARK: - parse: hostile / malformed ids

    @Test func rejectsIdsWithPathTraversal() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "../../etc/passwd", "pattern": "/a", "enabled": true, "response": ["status": 200, "body": "{}"]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsIdsWithScriptInjectionCharacters() {
        let raw: [String: Any] = [
            "kind": "mock.add",
            "rule": ["id": "<script>alert(1)</script>", "pattern": "/a", "enabled": true, "response": ["status": 200, "body": "{}"]],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsEmptyId() {
        #expect(parseControlCommand(["kind": "mock.remove", "id": ""]) == nil)
    }

    @Test func rejectsIdOver64Chars() {
        let longId = String(repeating: "a", count: 65)
        #expect(parseControlCommand(["kind": "mock.remove", "id": longId]) == nil)
    }

    @Test func acceptsIdAtExactly64Chars() {
        let id64 = String(repeating: "a", count: 64)
        let cmd = parseControlCommand(["kind": "mock.remove", "id": id64])
        guard case let .mockRemove(id) = cmd else {
            Issue.record("expected .mockRemove")
            return
        }
        #expect(id == id64)
    }

    @Test func rejectsIdWithSpaces() {
        #expect(parseControlCommand(["kind": "mock.remove", "id": "has spaces"]) == nil)
    }

    @Test func rejectsIdWithUnicode() {
        #expect(parseControlCommand(["kind": "mock.remove", "id": "id-\u{1F600}"]) == nil)
    }

    @Test func acceptsIdWithUnderscoreAndDash() {
        let cmd = parseControlCommand(["kind": "mock.remove", "id": "rule_1-abc"])
        guard case let .mockRemove(id) = cmd else {
            Issue.record("expected .mockRemove")
            return
        }
        #expect(id == "rule_1-abc")
    }

    // MARK: - apply -> engine assertions

    @Test func applyMockAddInsertsIntoMockEngine() {
        let (mock, bp, throttle) = freshEngines()
        let cmd = parseControlCommand([
            "kind": "mock.add",
            "rule": ["id": "m1", "pattern": "/api", "enabled": true, "response": ["status": 200, "body": "{}"]],
        ])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(mock.getRules().count == 1)
        #expect(mock.getRules().first?.id == "m1")
        #expect(mock.getRules().first?.pattern == "/api")
    }

    @Test func applyMockAddWithModifyRedirectToInsertsFullyIntoMockEngine() {
        let (mock, bp, throttle) = freshEngines()
        let cmd = parseControlCommand([
            "kind": "mock.add",
            "rule": [
                "id": "m-rewrite",
                "pattern": "/api",
                "enabled": true,
                "redirectTo": "https://other.example.com/api",
                "modify": ["status": 201, "setResponseHeaders": ["X-A": "1"]],
                "response": ["status": 200, "body": "{}"],
            ],
        ])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        let rule = mock.getRules().first
        #expect(rule?.redirectTo == "https://other.example.com/api")
        #expect(rule?.modify?.status == 201)
        #expect(rule?.modify?.setResponseHeaders?["X-A"] == "1")
        #expect(rule?.isRewrite == true)
    }

    @Test func applyMockRemoveDeletesFromMockEngine() {
        let (mock, bp, throttle) = freshEngines()
        mock.addRule(MockRuleInput(pattern: "/api", response: MockResponse(status: 200)), id: "m1")
        let cmd = parseControlCommand(["kind": "mock.remove", "id": "m1"])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(mock.getRules().isEmpty)
    }

    @Test func applyMockClearRemovesAllRules() {
        let (mock, bp, throttle) = freshEngines()
        mock.addRule(MockRuleInput(pattern: "/a", response: MockResponse()), id: "a")
        mock.addRule(MockRuleInput(pattern: "/b", response: MockResponse()), id: "b")
        let cmd = parseControlCommand(["kind": "mock.clear"])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(mock.getRules().isEmpty)
    }

    @Test func applyBreakpointAddInsertsIntoBreakpointEngine() {
        let (mock, bp, throttle) = freshEngines()
        let cmd = parseControlCommand([
            "kind": "breakpoint.add",
            "breakpoint": ["id": "bp1", "pattern": "/api", "on": "both", "enabled": true],
        ])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(bp.getBreakpoints().count == 1)
        #expect(bp.getBreakpoints().first?.id == "bp1")
        #expect(bp.getBreakpoints().first?.on == .both)
    }

    @Test func applyBreakpointRemoveDeletesFromBreakpointEngine() {
        let (mock, bp, throttle) = freshEngines()
        bp.addBreakpoint(BreakpointInput(pattern: "/api", enabled: true, id: "bp1"))
        let cmd = parseControlCommand(["kind": "breakpoint.remove", "id": "bp1"])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(bp.getBreakpoints().isEmpty)
    }

    @Test func applyThrottleSetPresetUpdatesThrottleEngine() {
        let (mock, bp, throttle) = freshEngines()
        let cmd = parseControlCommand(["kind": "throttle.set", "profile": "slow-3g"])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(throttle.config.profile == .slow3g)
        #expect(throttle.config.latencyMs == 400)
        #expect(throttle.config.downloadKbps == 400)
    }

    @Test func applyThrottleSetCustomUpdatesThrottleEngine() {
        let (mock, bp, throttle) = freshEngines()
        let raw: [String: Any] = ["kind": "throttle.set", "profile": "custom", "latencyMs": 77, "downloadKbps": 999]
        let cmd = parseControlCommand(raw)!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(throttle.config.profile == .custom)
        #expect(throttle.config.latencyMs == 77)
        #expect(throttle.config.downloadKbps == 999)
    }

    @Test func applyThrottleSetCustomWithNoValuesDefaultsToZero() {
        let (mock, bp, throttle) = freshEngines()
        let cmd = parseControlCommand(["kind": "throttle.set", "profile": "custom"])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(throttle.config.profile == .custom)
        #expect(throttle.config.latencyMs == 0)
        #expect(throttle.config.downloadKbps == 0)
    }

    @Test func applyThrottleSetNoneResetsToZeroOverhead() {
        let (mock, bp, throttle) = freshEngines()
        throttle.setProfile(.fast3g)
        let cmd = parseControlCommand(["kind": "throttle.set", "profile": "none"])!
        let result = applyControlCommand(cmd, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        #expect(result == .ok)
        #expect(throttle.config.profile == .none)
        #expect(throttle.isActive == false)
    }

    // MARK: - replace-by-id

    @Test func mockAddWithSameIdReplacesRuleInPlace() {
        let (mock, bp, throttle) = freshEngines()
        let first = parseControlCommand([
            "kind": "mock.add",
            "rule": ["id": "dup", "pattern": "/first", "enabled": true, "response": ["status": 200, "body": "{}"]],
        ])!
        let second = parseControlCommand([
            "kind": "mock.add",
            "rule": ["id": "dup", "pattern": "/second", "enabled": false, "response": ["status": 404, "body": "{}"]],
        ])!
        applyControlCommand(first, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        applyControlCommand(second, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)

        #expect(mock.getRules().count == 1)
        #expect(mock.getRules().first?.pattern == "/second")
        #expect(mock.getRules().first?.enabled == false)
        #expect(mock.getRules().first?.response.status == 404)
    }

    @Test func breakpointAddWithSameIdReplacesInPlace() {
        let (mock, bp, throttle) = freshEngines()
        let first = parseControlCommand([
            "kind": "breakpoint.add",
            "breakpoint": ["id": "dup", "pattern": "/first", "on": "request", "enabled": true],
        ])!
        let second = parseControlCommand([
            "kind": "breakpoint.add",
            "breakpoint": ["id": "dup", "pattern": "/second", "on": "response", "enabled": false],
        ])!
        applyControlCommand(first, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)
        applyControlCommand(second, mockEngine: mock, breakpointEngine: bp, throttleEngine: throttle)

        #expect(bp.getBreakpoints().count == 1)
        #expect(bp.getBreakpoints().first?.pattern == "/second")
        #expect(bp.getBreakpoints().first?.on == .response)
        #expect(bp.getBreakpoints().first?.enabled == false)
    }

    // MARK: - fail-open: engine forced to throw must never propagate

    private struct ForcedError: Error {}

    private final class ThrowingMockEngine: ControlMockEngine {
        func controlAddRule(_ input: MockRuleInput, id: String) throws { throw ForcedError() }
        func controlRemoveRule(id: String) throws { throw ForcedError() }
        func controlClearRules() throws { throw ForcedError() }
    }

    private final class ThrowingBreakpointEngine: ControlBreakpointEngine {
        func controlAddBreakpoint(_ input: BreakpointInput) throws { throw ForcedError() }
        func controlRemoveBreakpoint(id: String) throws { throw ForcedError() }
    }

    private final class ThrowingThrottleEngine: ControlThrottleEngine {
        func controlSetProfile(_ profile: ThrottleProfile) throws { throw ForcedError() }
        func controlSetCustom(latencyMs: Int, downloadKbps: Int) throws { throw ForcedError() }
    }

    @Test func mockAddFailOpenOnEngineThrow() {
        let cmd = parseControlCommand([
            "kind": "mock.add",
            "rule": ["id": "m1", "pattern": "/a", "enabled": true, "response": ["status": 200, "body": "{}"]],
        ])!
        let result = applyControlCommand(
            cmd,
            mockEngine: ThrowingMockEngine(),
            breakpointEngine: BreakpointEngine(),
            throttleEngine: ThrottleEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    @Test func mockRemoveFailOpenOnEngineThrow() {
        let cmd = parseControlCommand(["kind": "mock.remove", "id": "m1"])!
        let result = applyControlCommand(
            cmd,
            mockEngine: ThrowingMockEngine(),
            breakpointEngine: BreakpointEngine(),
            throttleEngine: ThrottleEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    @Test func mockClearFailOpenOnEngineThrow() {
        let cmd = parseControlCommand(["kind": "mock.clear"])!
        let result = applyControlCommand(
            cmd,
            mockEngine: ThrowingMockEngine(),
            breakpointEngine: BreakpointEngine(),
            throttleEngine: ThrottleEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    @Test func breakpointAddFailOpenOnEngineThrow() {
        let cmd = parseControlCommand([
            "kind": "breakpoint.add",
            "breakpoint": ["id": "bp1", "pattern": "/a", "enabled": true],
        ])!
        let result = applyControlCommand(
            cmd,
            mockEngine: MockEngine(),
            breakpointEngine: ThrowingBreakpointEngine(),
            throttleEngine: ThrottleEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    @Test func breakpointRemoveFailOpenOnEngineThrow() {
        let cmd = parseControlCommand(["kind": "breakpoint.remove", "id": "bp1"])!
        let result = applyControlCommand(
            cmd,
            mockEngine: MockEngine(),
            breakpointEngine: ThrowingBreakpointEngine(),
            throttleEngine: ThrottleEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    @Test func throttleSetFailOpenOnEngineThrow() {
        let cmd = parseControlCommand(["kind": "throttle.set", "profile": "slow-3g"])!
        let result = applyControlCommand(
            cmd,
            mockEngine: MockEngine(),
            breakpointEngine: BreakpointEngine(),
            throttleEngine: ThrowingThrottleEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    @Test func throttleSetCustomFailOpenOnEngineThrow() {
        let cmd = parseControlCommand(["kind": "throttle.set", "profile": "custom", "latencyMs": 10])!
        let result = applyControlCommand(
            cmd,
            mockEngine: MockEngine(),
            breakpointEngine: BreakpointEngine(),
            throttleEngine: ThrowingThrottleEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    // MARK: - fromPayloadJSON convenience wrapper

    @Test func parsesFromPayloadJSONData() throws {
        let json = """
        {"kind":"mock.clear"}
        """
        let data = try #require(json.data(using: .utf8))
        let cmd = parseControlCommand(fromPayloadJSON: data)
        #expect(cmd == .mockClear)
    }

    @Test func fromPayloadJSONReturnsNilForMalformedJSON() {
        let data = Data("not json at all {{{".utf8)
        #expect(parseControlCommand(fromPayloadJSON: data) == nil)
    }
}
