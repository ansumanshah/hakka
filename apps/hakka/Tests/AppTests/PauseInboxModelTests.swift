import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// A `PauseControlChannel` fake standing in for `TrafficModel`, mirroring
/// `RulesModelTests`'s `FakeControlChannel`.
@MainActor
private final class FakePauseChannel: PauseControlChannel {
    let pauses = PauseStore()
    var sendResult: Result<Int, Error> = .success(1)
    private(set) var sentCommands: [ControlCommand] = []

    func send(_ command: ControlCommand) async throws -> Int {
        sentCommands.append(command)
        return try sendResult.get()
    }
}

private func requestPause(id: String = "pause-1", device: String = "iphone-a") -> PendingPause {
    PendingPause(
        pauseId: id,
        ruleId: nil,
        phase: .request,
        device: device,
        request: BreakpointPausedRequestSnapshot(url: "https://api.test/x", method: "GET", headers: ["a": "1"]),
        response: nil
    )
}

private func responsePause(id: String = "pause-2") -> PendingPause {
    PendingPause(
        pauseId: id,
        ruleId: nil,
        phase: .response,
        device: "iphone-a",
        request: BreakpointPausedRequestSnapshot(url: "https://api.test/y", method: "POST", headers: [:]),
        response: BreakpointPausedResponseSnapshot(status: 200, headers: [:], body: "{}")
    )
}

@Suite("PauseInboxModel resume/abort")
@MainActor
struct PauseInboxModelResolveTests {
    /// A resume for a request-phase pause must carry `requestEdits`, never
    /// `responseEdits` — the "edit merge" the wire's `breakpoint.resume`
    /// exposes is phase-scoped, and sending the wrong half would apply
    /// edits the device has no matching phase to interpret.
    @Test func resumeOnARequestPhasePauseSendsRequestEditsOnly() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause())
        let model = PauseInboxModel(channel: channel)
        let edits = BreakpointRequestEdits(url: "https://api.test/edited", method: "POST")

        model.resume(requestPause(), requestEdits: edits)
        try await Task.sleep(for: .milliseconds(50))

        let sent = try #require(channel.sentCommands.first)
        guard case let .breakpointResume(pauseId, requestEdits, responseEdits) = sent else {
            Issue.record("expected .breakpointResume")
            return
        }
        #expect(pauseId == "pause-1")
        #expect(requestEdits?.url == "https://api.test/edited")
        #expect(requestEdits?.method == "POST")
        #expect(responseEdits == nil)
    }

    @Test func resumeOnAResponsePhasePauseSendsResponseEditsOnly() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(responsePause())
        let model = PauseInboxModel(channel: channel)
        let edits = BreakpointResponseEdits(status: 404, body: "not found")

        model.resume(responsePause(), responseEdits: edits)
        try await Task.sleep(for: .milliseconds(50))

        let sent = try #require(channel.sentCommands.first)
        guard case let .breakpointResume(pauseId, requestEdits, responseEdits) = sent else {
            Issue.record("expected .breakpointResume")
            return
        }
        #expect(pauseId == "pause-2")
        #expect(requestEdits == nil)
        #expect(responseEdits?.status == 404)
        #expect(responseEdits?.body == "not found")
    }

    @Test func successfulResumeRemovesTheEntryFromTheStore() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause())
        channel.sendResult = .success(1)
        let model = PauseInboxModel(channel: channel)

        model.resume(requestPause())
        try await Task.sleep(for: .milliseconds(50))

        #expect(await channel.pauses.pause(id: "pause-1") == nil)
    }

    /// The send failed outright — the device never heard about it, so the
    /// pause must stay in the inbox rather than vanish as if resolved.
    @Test func aFailedSendLeavesThePauseInTheStore() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause())
        channel.sendResult = .failure(ControlWireError.encodingFailed("boom"))
        let model = PauseInboxModel(channel: channel)

        model.abort(requestPause())
        try await Task.sleep(for: .milliseconds(50))

        #expect(await channel.pauses.pause(id: "pause-1") != nil)
        #expect(model.deliveryNote?.hasPrefix("Failed") == true)
    }

    /// `ControlSender` returning `0` delivered ("no devices connected") is
    /// not a send failure, but it must not read as a silent success either
    /// — the developer needs to know the abort/resume may never have
    /// reached the paused device.
    @Test func zeroDevicesDeliveredIsNoteedHonestly() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause())
        channel.sendResult = .success(0)
        let model = PauseInboxModel(channel: channel)

        model.abort(requestPause())
        try await Task.sleep(for: .milliseconds(50))

        #expect(model.deliveryNote == "No devices connected — the request may still be paused on the device")
    }

    @Test func abortAllForTerminationSendsAbortForEveryEntry() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause(id: "a"))
        await channel.pauses.ingest(requestPause(id: "b", device: "iphone-b"))
        let model = PauseInboxModel(channel: channel)
        let observeTask = Task { await model.observe() }
        try await Task.sleep(for: .milliseconds(50))
        observeTask.cancel()

        await model.abortAllForTermination()

        let abortedIDs = channel.sentCommands.compactMap { command -> String? in
            guard case let .breakpointAbort(pauseId) = command else { return nil }
            return pauseId
        }
        #expect(Set(abortedIDs) == ["a", "b"])
    }
}

/// DECISION 1 coverage: an unanswered pause resolves itself. The real
/// default is 5 minutes; these inject a millisecond-scale timeout so the
/// test doesn't wait on it.
@Suite("PauseInboxModel timeout")
@MainActor
struct PauseInboxModelTimeoutTests {
    @Test func anUnresolvedPauseIsAutoAbortedAfterItsTimeout() async throws {
        let channel = FakePauseChannel()
        let model = PauseInboxModel(channel: channel, autoAbortTimeout: .milliseconds(30))
        let observeTask = Task { await model.observe() }
        await channel.pauses.ingest(requestPause())
        // Give `observe()`'s stream loop a moment to pick up the ingest and
        // schedule the watchdog before the timeout would otherwise fire.
        try await Task.sleep(for: .milliseconds(10))

        try await Task.sleep(for: .milliseconds(80))
        observeTask.cancel()

        let aborted = channel.sentCommands.contains { command in
            if case .breakpointAbort(pauseId: "pause-1") = command { return true }
            return false
        }
        #expect(aborted, "an unanswered pause must eventually auto-abort, or a forgotten pause wedges the device forever")
        #expect(model.deliveryNote?.contains("Timed out") == true)
    }

    /// A pause the developer resolves before the timeout must not also fire
    /// a redundant auto-abort afterward.
    @Test func aManuallyResolvedPauseDoesNotAlsoAutoAbort() async throws {
        let channel = FakePauseChannel()
        let model = PauseInboxModel(channel: channel, autoAbortTimeout: .milliseconds(30))
        let observeTask = Task { await model.observe() }
        await channel.pauses.ingest(requestPause())
        try await Task.sleep(for: .milliseconds(10))

        model.resume(requestPause())
        try await Task.sleep(for: .milliseconds(80))
        observeTask.cancel()

        let commandCount = channel.sentCommands.count
        #expect(commandCount == 1, "cancelling the watchdog on manual resolution must prevent a second, redundant send")
    }
}
