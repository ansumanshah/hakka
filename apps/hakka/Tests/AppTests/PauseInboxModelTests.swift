import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// Records commands while using the real pause store.
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
    /// Resume edits must match the pause phase.
    @Test func resumeOnARequestPhasePauseSendsRequestEditsOnly() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause())
        let model = PauseInboxModel(channel: channel)
        let edits = BreakpointRequestEdits(url: "https://api.test/edited", method: "POST")

        model.resume(requestPause(), requestEdits: edits)
        await model.lastActionTask?.value

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
        await model.lastActionTask?.value

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
        await model.lastActionTask?.value

        #expect(await channel.pauses.pause(id: "pause-1") == nil)
    }

    /// Failed delivery leaves the pause available for retry.
    @Test func aFailedSendLeavesThePauseInTheStore() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause())
        channel.sendResult = .failure(ControlWireError.encodingFailed("boom"))
        let model = PauseInboxModel(channel: channel)

        model.abort(requestPause())
        await model.lastActionTask?.value

        #expect(await channel.pauses.pause(id: "pause-1") != nil)
        #expect(model.deliveryNote?.hasPrefix("Failed") == true)
    }

    /// Zero recipients must be reported without implying the device resumed.
    @Test func zeroDevicesDeliveredIsReportedHonestly() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause())
        channel.sendResult = .success(0)
        let model = PauseInboxModel(channel: channel)

        model.abort(requestPause())
        await model.lastActionTask?.value

        #expect(model.deliveryNote == "No devices connected — the request may still be paused on the device")
    }

    /// Failed delivery must re-arm the watchdog.
    @Test func aFailedResolveReschedulesTheAutoAbortWatchdog() async throws {
        let channel = FakePauseChannel()
        channel.sendResult = .failure(ControlWireError.encodingFailed("boom"))
        let model = PauseInboxModel(channel: channel, autoAbortTimeout: .milliseconds(30))
        let observeTask = Task { await model.observe() }
        await channel.pauses.ingest(requestPause())
        try await waitUntil { model.debugHasTimeoutSlotForTest("pause-1") }

        model.abort(requestPause())
        await model.lastActionTask?.value
        // Let the retry succeed.
        channel.sendResult = .success(1)
        try await waitUntil {
            channel.sentCommands.filter { command in
                if case .breakpointAbort(pauseId: "pause-1") = command { return true }
                return false
            }.count >= 2
        }
        await model.lastActionTask?.value
        observeTask.cancel()

        let abortsSent = channel.sentCommands.filter { command in
            if case .breakpointAbort(pauseId: "pause-1") = command { return true }
            return false
        }
        #expect(
            abortsSent.count >= 2,
            "the failed manual abort plus a rescheduled watchdog's auto-abort must both fire; got \(abortsSent.count)"
        )
        #expect(
            await channel.pauses.pause(id: "pause-1") == nil,
            "the rescheduled watchdog's auto-abort must eventually resolve and remove the pause"
        )
        #expect(model.deliveryNote?.contains("Timed out") == true)
    }

    @Test func abortAllForTerminationSendsAbortForEveryEntry() async throws {
        let channel = FakePauseChannel()
        await channel.pauses.ingest(requestPause(id: "a"))
        await channel.pauses.ingest(requestPause(id: "b", device: "iphone-b"))
        let model = PauseInboxModel(channel: channel)
        let observeTask = Task { await model.observe() }
        try await waitUntil { model.entries.count == 2 }
        observeTask.cancel()

        await model.abortAllForTermination()

        let abortedIDs = channel.sentCommands.compactMap { command -> String? in
            guard case let .breakpointAbort(pauseId) = command else { return nil }
            return pauseId
        }
        #expect(Set(abortedIDs) == ["a", "b"])
    }
}

/// Wait on MainActor state; fail if it never reaches the expected value.
@MainActor
private func waitUntil(
    _ deadline: Duration = .seconds(5),
    _ condition: () -> Bool
) async throws {
    let start = ContinuousClock.now
    while ContinuousClock.now - start < deadline {
        if condition() { return }
        try await Task.sleep(for: .milliseconds(5))
    }
    try #require(condition(), "Condition did not become true before the deadline")
}

@Suite("PauseInboxModel timeout")
@MainActor
struct PauseInboxModelTimeoutTests {
    @Test func anUnresolvedPauseIsAutoAbortedAfterItsTimeout() async throws {
        let channel = FakePauseChannel()
        let model = PauseInboxModel(channel: channel, autoAbortTimeout: .milliseconds(30))
        let observeTask = Task { await model.observe() }
        await channel.pauses.ingest(requestPause())
        try await waitUntil {
            channel.sentCommands.contains { command in
                if case .breakpointAbort(pauseId: "pause-1") = command { return true }
                return false
            }
        }
        await model.lastActionTask?.value
        observeTask.cancel()

        let aborted = channel.sentCommands.contains { command in
            if case .breakpointAbort(pauseId: "pause-1") = command { return true }
            return false
        }
        #expect(aborted, "an unanswered pause must eventually auto-abort, or a forgotten pause wedges the device forever")
        #expect(model.deliveryNote?.contains("Timed out") == true)
    }

    /// Reusing a vanished pause ID must schedule a fresh watchdog.
    @Test func aVanishedPauseDoesNotLeakItsWatchdogSlot() async throws {
        let channel = FakePauseChannel()
        let model = PauseInboxModel(channel: channel, autoAbortTimeout: .milliseconds(30))
        let observeTask = Task { await model.observe() }
        await channel.pauses.ingest(requestPause())
        try await waitUntil { model.debugHasTimeoutSlotForTest("pause-1") }

        await channel.pauses.remove(pauseId: "pause-1")
        try await waitUntil { model.entries.isEmpty }
        // Let the stale watchdog clear its slot before reusing the ID.
        try await waitUntil { !model.debugHasTimeoutSlotForTest("pause-1") }

        await channel.pauses.ingest(requestPause())
        try await waitUntil {
            channel.sentCommands.contains { command in
                if case .breakpointAbort(pauseId: "pause-1") = command { return true }
                return false
            }
        }
        observeTask.cancel()

        let abortsForPause1 = channel.sentCommands.filter { command in
            if case .breakpointAbort(pauseId: "pause-1") = command { return true }
            return false
        }
        #expect(
            abortsForPause1.count == 1,
            "the re-ingested pause must get its own watchdog and auto-abort, not be starved by a leaked timeout slot from the vanished one"
        )
    }

    /// Manual resolution cancels the watchdog.
    @Test func aManuallyResolvedPauseDoesNotAlsoAutoAbort() async throws {
        let channel = FakePauseChannel()
        let model = PauseInboxModel(channel: channel, autoAbortTimeout: .milliseconds(30))
        let observeTask = Task { await model.observe() }
        await channel.pauses.ingest(requestPause())
        try await waitUntil { model.debugHasTimeoutSlotForTest("pause-1") }

        model.resume(requestPause())
        await model.lastActionTask?.value
        try await Task.sleep(for: .milliseconds(80))
        observeTask.cancel()

        let commandCount = channel.sentCommands.count
        #expect(commandCount == 1, "cancelling the watchdog on manual resolution must prevent a second, redundant send")
    }
}
