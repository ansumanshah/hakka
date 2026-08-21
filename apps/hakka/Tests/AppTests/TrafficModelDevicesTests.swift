import Foundation
import HakkaCommon
import HakkaCore
import HakkaServer
import Testing
@testable import HakkaApp

/// Device-sidebar coverage that needs a real bridge, not the seeded
/// `setBuffer`/`deviceIndex` state `TrafficModelDeviceFilterTests` uses —
/// `BridgeSocketTests` (Tests/CoreTests) documents why a fake-peer-only
/// test can stay green while the real thing is broken. This drives an
/// actual `TrafficModel` (real `BridgeServer`, real loopback sockets)
/// through the same `start()` path the desktop app itself runs, on an
/// ephemeral port injected via `TrafficModel.init(server:)` so this suite
/// never fights another test — or a running app — for `bridgeDefaultPort`.
@Suite("TrafficModel devices")
@MainActor
struct TrafficModelDevicesTests {
    /// Polls the actor's own `boundPort`, not `TrafficModel.boundPort` —
    /// that field is a one-time snapshot taken right after `server.start()`
    /// returns (`TrafficModel.swift`'s `start()`), which for an ephemeral
    /// port (`0`, used here so this suite never fights another test for
    /// `bridgeDefaultPort`) can still read `0` at that instant; the actor's
    /// `boundPort` keeps resolving afterward the same way
    /// `BridgeSocketTests.boundPort(of:)` polls it directly.
    private func boundPort(of model: TrafficModel) async -> UInt16? {
        for _ in 0..<100 {
            if let port = await model.server.boundPort, port != 0 { return port }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return nil
    }

    /// Polls `condition` until it's true or `timeout` elapses, returning the
    /// final read either way — every assertion below reports what it saw,
    /// not just "it never happened".
    private func waitUntil(timeout: Duration = .seconds(5), _ condition: () -> Bool) async -> Bool {
        let deadline = ContinuousClock.now + timeout
        while ContinuousClock.now < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return condition()
    }

    private func requestFrame(id: String, url: String) -> String {
        #"{"type":"request","payload":{"id":"\#(id)","url":"\#(url)","method":"GET","startTime":1}}"#
    }

    private func openSocket(port: UInt16) -> URLSessionWebSocketTask {
        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        return task
    }

    @Test func twoConnectedClientsProduceTwoListedDevices() async throws {
        let model = TrafficModel(server: BridgeServer(options: BridgeServerOptions(port: 0, advertise: false)))
        let runTask = Task { await model.start() }
        defer { runTask.cancel() }
        let port = try #require(await boundPort(of: model))

        let clientA = openSocket(port: port)
        try await clientA.send(.string(requestFrame(id: "a-1", url: "https://a.test/1")))
        let clientB = openSocket(port: port)
        try await clientB.send(.string(requestFrame(id: "b-1", url: "https://b.test/1")))

        let listed = await waitUntil {
            model.devices.count == 2 && model.devices.allSatisfy { $0.label != nil }
        }
        clientA.cancel(with: .goingAway, reason: nil)
        clientB.cancel(with: .goingAway, reason: nil)

        #expect(listed, "two connected clients must both appear in TrafficModel.devices, got \(model.devices)")
        #expect(
            Set(model.devices.compactMap(\.label)).count == 2,
            "two distinct clients must not collapse into one listed device"
        )
    }

    @Test func aDisconnectMarksTheDeviceWithoutLosingItsTraffic() async throws {
        let model = TrafficModel(server: BridgeServer(options: BridgeServerOptions(port: 0, advertise: false)))
        let runTask = Task { await model.start() }
        defer { runTask.cancel() }
        let port = try #require(await boundPort(of: model))

        let client = openSocket(port: port)
        try await client.send(.string(requestFrame(id: "d-1", url: "https://d.test/1")))

        let captured = await waitUntil { model.requests.contains { $0.id == "d-1" } }
        #expect(captured, "the request must be captured before the disconnect this test drives")
        let labeled = await waitUntil { model.devices.first?.label != nil }
        #expect(labeled, "the device must be labeled before the disconnect this test drives")
        let deviceLabel = try #require(model.devices.first?.label)

        // Plain `cancel()`, not `cancel(with:reason:)` — see
        // `BridgeSocketTests.aDisconnectedClientEmitsADisconnectedEventForTheSamePeer`
        // for why the graceful-close variant was observed taking upward of
        // 15s to be observed server-side in this environment.
        client.cancel()
        let disconnected = await waitUntil(timeout: .seconds(15)) { model.devices.first?.isConnected == false }

        #expect(disconnected, "disconnecting the socket must flip the device to isConnected == false")
        #expect(model.devices.count == 1, "a disconnect must change state, not delete the device row")
        #expect(model.devices.first?.label == deviceLabel, "disconnection must not change or clear the device's label")
        #expect(model.requests.contains { $0.id == "d-1" }, "the disconnected device's traffic must still be in the buffer")
        #expect(
            model.deviceLabel(for: "d-1") == deviceLabel,
            "the request must still be attributed to its device after the device disconnects"
        )
    }
}
