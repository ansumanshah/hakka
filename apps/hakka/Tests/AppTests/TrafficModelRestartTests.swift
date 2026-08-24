import Foundation
import HakkaCommon
import HakkaCore
import HakkaServer
import Testing
@testable import HakkaApp

/// Pins the restart path `TrafficModelDevicesTests` doesn't cover: SwiftUI
/// cancels a scene's `.task` when its window closes (`AppDelegate.swift`'s
/// doc comment), but the app itself keeps running, and a later window's
/// `.task` re-invokes `start()`. Same real-`BridgeServer`, real-loopback-
/// socket setup as `TrafficModelDevicesTests`, on its own ephemeral port so
/// this suite never fights another test for `bridgeDefaultPort`.
@Suite("TrafficModel restart")
@MainActor
struct TrafficModelRestartTests {
    private func boundPort(of model: TrafficModel) async -> UInt16? {
        for _ in 0..<100 {
            if let port = await model.server.boundPort, port != 0 { return port }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return nil
    }

    private func waitUntil(timeout: Duration = .seconds(5), _ condition: () -> Bool) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return condition()
    }

    /// Without resetting `isRunning` when the cancelled task group ends,
    /// `guard !isRunning else { return }` blocks every later `start()` call
    /// forever — the app looks alive but a reopened window can never
    /// re-enter `start()` at all.
    @Test(.timeLimit(.minutes(1)))
    func cancellingStartResetsIsRunningSoALaterStartIsNotAPermanentNoOp() async throws {
        let model = TrafficModel(server: BridgeServer(options: BridgeServerOptions(port: 0, advertise: false)))
        let firstRun = Task { await model.start() }
        _ = try #require(await boundPort(of: model))
        let running = await waitUntil { model.isRunning }
        #expect(running, "sanity check: the first start() must actually flip isRunning")

        firstRun.cancel()
        _ = await firstRun.value

        let stoppedRunning = await waitUntil { !model.isRunning }
        #expect(
            stoppedRunning,
            "cancelling the driving task must reset isRunning, or every later start() is permanently blocked by guard !isRunning"
        )
    }

    private func requestFrame(id: String, url: String) -> String {
        #"{"type":"request","payload":{"id":"\#(id)","url":"\#(url)","method":"GET","startTime":1}}"#
    }

    private func openSocket(port: UInt16) -> URLSessionWebSocketTask {
        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        return task
    }

    /// The end-to-end proof `cancellingStartResetsIsRunningSoALaterStartIsNotAPermanentNoOp`
    /// above cannot give: that `isRunning` toggling correctly is not the
    /// same as capture actually resuming. Before `BridgeHub` moved to
    /// per-subscription broadcast streams (ADR 0013), a stored `AsyncStream`
    /// died the instant ANY consumer's suspended `next()` was abandoned by
    /// cancellation — not just for the cancelled consumer, but for the
    /// stream's shared storage, permanently. So a second `start()` here
    /// would pass every `isRunning` assertion above while silently
    /// receiving zero elements from a real second client: `isRunning` says
    /// alive, capture says dead. This test drives the full cycle — start,
    /// a real loopback client connects and captures, cancel the driving
    /// task exactly like SwiftUI cancelling a closed window's `.task`,
    /// start again, and a SECOND real loopback client connects and
    /// captures — using the same real-`BridgeServer`, real-socket harness
    /// `TrafficModelDevicesTests` uses, on its own ephemeral port.
    @Test(.timeLimit(.minutes(1)))
    func restartingAfterCancellationResumesCaptureForANewClient() async throws {
        let model = TrafficModel(server: BridgeServer(options: BridgeServerOptions(port: 0, advertise: false)))

        let firstRun = Task { await model.start() }
        let port = try #require(await boundPort(of: model))
        let firstRunning = await waitUntil { model.isRunning }
        #expect(firstRunning, "sanity check: the first start() must actually flip isRunning")

        let firstClient = openSocket(port: port)
        try await firstClient.send(.string(requestFrame(id: "before-restart", url: "https://before.test/1")))
        let firstCaptured = await waitUntil { model.requests.contains { $0.id == "before-restart" } }
        firstClient.cancel(with: .goingAway, reason: nil)
        #expect(firstCaptured, "the first client's request must be captured before this test drives a restart")

        // Simulates a window close: SwiftUI cancels the scene's `.task`,
        // which is what's driving `model.start()` here.
        firstRun.cancel()
        _ = await firstRun.value
        let stoppedRunning = await waitUntil { !model.isRunning }
        #expect(stoppedRunning, "cancelling the driving task must reset isRunning before this test starts again")

        // A reopened window's `.task` re-invokes `start()` on the SAME
        // model/hub, same as `TrafficModel.start()`'s own doc comment
        // describes.
        let secondRun = Task { await model.start() }
        defer { secondRun.cancel() }
        let secondRunning = await waitUntil { model.isRunning }
        #expect(secondRunning, "the second start() must also flip isRunning")

        let secondClient = openSocket(port: port)
        try await secondClient.send(.string(requestFrame(id: "after-restart", url: "https://after.test/1")))
        let secondCaptured = await waitUntil(timeout: .seconds(10)) {
            model.requests.contains { $0.id == "after-restart" }
        }
        secondClient.cancel(with: .goingAway, reason: nil)

        #expect(
            secondCaptured,
            "a SECOND client connecting after a restart must still be captured — got \(model.requests.map(\.id))"
        )
        #expect(
            model.requests.contains { $0.id == "before-restart" },
            "the restart must not have discarded traffic captured before it"
        )
    }
}
