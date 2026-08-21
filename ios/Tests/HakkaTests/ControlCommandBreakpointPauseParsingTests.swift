import Foundation
import Testing
@testable import HakkaCommon

// MARK: - breakpoint.paused / .resume / .abort — parsing
//
// Mirrors the taxonomy in `packages/hakka-core/src/engine/__tests__/control.test.ts`:
// valid shapes, then missing field / wrong type / empty id / oversized /
// unknown phase. Fixture-backed cases read the pinned JSON in
// `fixtures/control/` so a shape drift here fails the TS and Kotlin tests too.

@Suite("ControlCommand — breakpoint pause parsing")
struct ControlCommandBreakpointPauseParsingTests {

    // MARK: - valid shapes

    @Test func parsesBreakpointPausedResponsePhaseFixture() throws {
        let raw = try ControlFixtures.readJSON("breakpoint-paused.json")
        let cmd = parseControlCommand(raw)
        guard case let .breakpointPaused(pauseId, ruleId, phase, device, request, response) = cmd else {
            Issue.record("expected .breakpointPaused, got \(String(describing: cmd))")
            return
        }
        #expect(pauseId == "pause_7")
        #expect(ruleId == "bp-checkout")
        #expect(phase == .response)
        #expect(device == "ios-simulator-6")
        #expect(request.url == "https://api.example.com/checkout")
        #expect(request.method == "POST")
        #expect(request.headers["accept"] == "application/json")
        #expect(response?.status == 200)
        #expect(response?.body == "{\"ok\":true}")
    }

    @Test func parsesBreakpointPausedRequestPhaseWithoutResponseBlock() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused",
            "pauseId": "pause_2",
            "phase": "request",
            "device": "android-emulator",
            "request": ["url": "https://api.example.com/x", "method": "POST", "headers": [String: Any](), "body": "{}"],
        ]
        let cmd = parseControlCommand(raw)
        guard case let .breakpointPaused(_, ruleId, phase, _, request, response) = cmd else {
            Issue.record("expected .breakpointPaused, got \(String(describing: cmd))")
            return
        }
        #expect(ruleId == nil)
        #expect(phase == .request)
        #expect(response == nil)
        #expect(request.body == "{}")
    }

    @Test func parsesBreakpointResumeRequestEditsFixture() throws {
        let raw = try ControlFixtures.readJSON("breakpoint-resume-request.json")
        let cmd = parseControlCommand(raw)
        guard case let .breakpointResume(pauseId, requestEdits, responseEdits) = cmd else {
            Issue.record("expected .breakpointResume, got \(String(describing: cmd))")
            return
        }
        #expect(pauseId == "pause_3")
        #expect(requestEdits?.url == "https://api.example.com/checkout?debug=1")
        #expect(requestEdits?.method == "POST")
        #expect(requestEdits?.headers?["x-injected"] == "1")
        #expect(responseEdits == nil)
    }

    @Test func parsesBreakpointResumeResponseEditsFixture() throws {
        let raw = try ControlFixtures.readJSON("breakpoint-resume-response.json")
        let cmd = parseControlCommand(raw)
        guard case let .breakpointResume(pauseId, requestEdits, responseEdits) = cmd else {
            Issue.record("expected .breakpointResume, got \(String(describing: cmd))")
            return
        }
        #expect(pauseId == "pause_7")
        #expect(requestEdits == nil)
        #expect(responseEdits?.status == 201)
        #expect(responseEdits?.headers?["x-injected"] == "1")
    }

    @Test func parsesBreakpointResumeWithNoEditsAtAll() {
        let cmd = parseControlCommand(["kind": "breakpoint.resume", "pauseId": "pause_9"])
        guard case let .breakpointResume(pauseId, requestEdits, responseEdits) = cmd else {
            Issue.record("expected .breakpointResume, got \(String(describing: cmd))")
            return
        }
        #expect(pauseId == "pause_9")
        #expect(requestEdits == nil)
        #expect(responseEdits == nil)
    }

    @Test func parsesBreakpointAbortFixture() throws {
        let raw = try ControlFixtures.readJSON("breakpoint-abort.json")
        let cmd = parseControlCommand(raw)
        guard case let .breakpointAbort(pauseId) = cmd else {
            Issue.record("expected .breakpointAbort, got \(String(describing: cmd))")
            return
        }
        #expect(pauseId == "pause_7")
    }

    // MARK: - hostile / malformed — missing field, wrong type, empty id, oversized, unknown phase

    @Test func rejectsBreakpointPausedMissingPauseId() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "phase": "request", "device": "x",
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedEmptyPauseId() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "pauseId": "", "phase": "request", "device": "x",
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedOversizedPauseId() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "pauseId": String(repeating: "a", count: 257), "phase": "request", "device": "x",
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedUnknownPhase() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "pauseId": "p1", "phase": "sideways", "device": "x",
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedPhaseBoth() {
        // "both" is a valid BreakpointPhase for rule matching but not a valid live-pause phase.
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "pauseId": "p1", "phase": "both", "device": "x",
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedMissingDevice() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "pauseId": "p1", "phase": "request",
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedWrongTypeDevice() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "pauseId": "p1", "phase": "request", "device": 42,
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedMissingRequest() {
        let raw: [String: Any] = ["kind": "breakpoint.paused", "pauseId": "p1", "phase": "request", "device": "x"]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointPausedResponseMissingBody() {
        let raw: [String: Any] = [
            "kind": "breakpoint.paused", "pauseId": "p1", "phase": "response", "device": "x",
            "request": ["url": "u", "method": "GET", "headers": [String: Any]()],
            "response": ["status": 200, "headers": [String: Any]()],
        ]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointResumeMissingPauseId() {
        #expect(parseControlCommand(["kind": "breakpoint.resume"]) == nil)
    }

    @Test func rejectsBreakpointResumeEmptyPauseId() {
        #expect(parseControlCommand(["kind": "breakpoint.resume", "pauseId": ""]) == nil)
    }

    @Test func rejectsBreakpointResumeOversizedPauseId() {
        let raw: [String: Any] = ["kind": "breakpoint.resume", "pauseId": String(repeating: "a", count: 257)]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointResumeRequestEditsWithWrongTypeHeaders() {
        let raw: [String: Any] = ["kind": "breakpoint.resume", "pauseId": "p1", "requestEdits": ["headers": "nope"]]
        #expect(parseControlCommand(raw) == nil)
    }

    @Test func rejectsBreakpointAbortMissingPauseId() {
        #expect(parseControlCommand(["kind": "breakpoint.abort"]) == nil)
    }

    @Test func rejectsBreakpointAbortNonStringPauseId() {
        #expect(parseControlCommand(["kind": "breakpoint.abort", "pauseId": 42]) == nil)
    }
}
