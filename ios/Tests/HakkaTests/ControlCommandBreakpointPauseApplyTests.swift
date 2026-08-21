import Foundation
import Testing
@testable import HakkaCommon

// MARK: - breakpoint.paused / .resume / .abort — apply + direction

@Suite("ControlCommand — breakpoint pause apply", .serialized)
struct ControlCommandBreakpointPauseApplyTests {

    @Test func breakpointResumeWithRequestEditsMergesOverTheOriginalSnapshot() async throws {
        let engine = BreakpointEngine()
        let original = PausedRequest(url: "https://api.example.com/x", method: "GET", headers: ["a": "1"], body: nil)

        async let actionTask: ResumeRequestAction = withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: engine.pauseRequest(url: original.url, method: original.method, requestId: "req-1", request: original))
            }
        }

        // Wait for the pause to register before resuming it.
        while engine.getPaused().isEmpty { await Task.yield() }
        let pauseId = engine.getPaused().first!.id

        let cmd = ControlCommand.breakpointResume(
            pauseId: pauseId,
            requestEdits: BreakpointRequestEdits(method: "POST"),
            responseEdits: nil
        )
        let result = applyControlCommand(cmd, breakpointEngine: engine)
        #expect(result == .ok)

        let action = await actionTask
        guard case let .resume(edits) = action, let edits else {
            Issue.record("expected .resume(edits:) with non-nil edits, got \(action)")
            return
        }
        // Unedited fields carry over from the original snapshot — a partial
        // wire edit must not blank out fields the host never touched.
        #expect(edits.method == "POST")
        #expect(edits.url == original.url)
        #expect(edits.headers == original.headers)
    }

    @Test func breakpointResumeWithResponseEditsMergesOverTheOriginalSnapshot() async throws {
        let engine = BreakpointEngine()
        let original = PausedResponse(status: 200, headers: ["a": "1"], body: "original-body")

        async let actionTask: ResumeResponseAction = withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: engine.pauseResponse(url: "https://api.example.com/x", method: "GET", requestId: "req-2", response: original))
            }
        }

        while engine.getPaused().isEmpty { await Task.yield() }
        let pauseId = engine.getPaused().first!.id

        let cmd = ControlCommand.breakpointResume(pauseId: pauseId, requestEdits: nil, responseEdits: BreakpointResponseEdits(status: 500))
        let result = applyControlCommand(cmd, breakpointEngine: engine)
        #expect(result == .ok)

        let action = await actionTask
        guard case let .resume(edits) = action, let edits else {
            Issue.record("expected .resume(edits:) with non-nil edits, got \(action)")
            return
        }
        #expect(edits.status == 500)
        #expect(edits.body == "original-body")
    }

    @Test func breakpointResumeForUnknownPauseIdIsStillOkIdempotent() {
        let engine = BreakpointEngine()
        let result = applyControlCommand(.breakpointResume(pauseId: "never-existed", requestEdits: nil, responseEdits: nil), breakpointEngine: engine)
        #expect(result == .ok)
    }

    @Test func breakpointAbortResolvesThePauseWithAnAbortAction() async throws {
        let engine = BreakpointEngine()
        let original = PausedRequest(url: "https://api.example.com/y", method: "GET", headers: [:], body: nil)

        async let actionTask: ResumeRequestAction = withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                continuation.resume(returning: engine.pauseRequest(url: original.url, method: original.method, requestId: "req-3", request: original))
            }
        }

        while engine.getPaused().isEmpty { await Task.yield() }
        let pauseId = engine.getPaused().first!.id

        let result = applyControlCommand(.breakpointAbort(pauseId: pauseId), breakpointEngine: engine)
        #expect(result == .ok)

        let action = await actionTask
        guard case .abort = action else {
            Issue.record("expected .abort, got \(action)")
            return
        }
    }

    @Test func breakpointPausedIsRefusedADeviceMustNeverApplyItsOwnPauseNotification() {
        let cmd = ControlCommand.breakpointPaused(
            pauseId: "pause_1",
            ruleId: nil,
            phase: .request,
            device: "ios-simulator",
            request: BreakpointPausedRequestSnapshot(url: "https://api.example.com/x", method: "GET", headers: [:]),
            response: nil
        )
        let result = applyControlCommand(cmd)
        guard case let .failure(message) = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
        #expect(message.contains("device to host only"))
    }

    // MARK: - fail-open

    private struct ForcedError: Error {}

    private final class ThrowingBreakpointEngine: ControlBreakpointEngine {
        func controlAddBreakpoint(_ input: BreakpointInput) throws { throw ForcedError() }
        func controlRemoveBreakpoint(id: String) throws { throw ForcedError() }
        func controlResumeBreakpoint(pauseId: String, requestEdits: BreakpointRequestEdits?, responseEdits: BreakpointResponseEdits?) throws {
            throw ForcedError()
        }
        func controlAbortBreakpoint(pauseId: String) throws { throw ForcedError() }
    }

    @Test func breakpointResumeFailOpenOnEngineThrow() {
        let result = applyControlCommand(
            .breakpointResume(pauseId: "p1", requestEdits: nil, responseEdits: nil),
            breakpointEngine: ThrowingBreakpointEngine()
        )
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    @Test func breakpointAbortFailOpenOnEngineThrow() {
        let result = applyControlCommand(.breakpointAbort(pauseId: "p1"), breakpointEngine: ThrowingBreakpointEngine())
        guard case .failure = result else {
            Issue.record("expected .failure, got \(result)")
            return
        }
    }

    // MARK: - direction guard

    @Test func isDeviceToHostCommandIsTrueOnlyForBreakpointPaused() {
        let paused = ControlCommand.breakpointPaused(
            pauseId: "p1", ruleId: nil, phase: .request, device: "x",
            request: BreakpointPausedRequestSnapshot(url: "u", method: "GET", headers: [:]), response: nil
        )
        #expect(isDeviceToHostCommand(paused) == true)

        let hostToDevice: [ControlCommand] = [
            .mockClear,
            .breakpointResume(pauseId: "p1", requestEdits: nil, responseEdits: nil),
            .breakpointAbort(pauseId: "p1"),
            .throttleSet(profile: .none, latencyMs: nil, downloadKbps: nil),
        ]
        for cmd in hostToDevice {
            #expect(isDeviceToHostCommand(cmd) == false)
        }
    }
}
