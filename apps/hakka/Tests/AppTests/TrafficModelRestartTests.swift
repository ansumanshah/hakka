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
}
