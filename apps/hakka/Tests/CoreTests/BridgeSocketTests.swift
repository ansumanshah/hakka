import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore
@testable import HakkaServer

/// The one path `ServerTests` could not cover: a real socket. Those tests
/// drive `BridgeHub` through injected fake peers, which is why they stayed
/// green while the app received nothing at all. `BridgeServer` created a
/// `BridgeConnection` in its `newConnectionHandler` and kept no reference to
/// it; every other reference was weak, so the peer deallocated as soon as the
/// handler returned. The framework kept the `NWConnection` alive long enough
/// to finish the WebSocket handshake, so a client connected successfully and
/// then every frame it sent was silently discarded.
///
/// Loopback only, on an ephemeral port. Nothing here reaches the network.
@Suite("Bridge over a real socket")
struct BridgeSocketTests {
    /// `NWListener` resolves its ephemeral port asynchronously after `start()`,
    /// so `boundPort` is briefly nil or zero. Poll rather than assume.
    private func boundPort(of server: BridgeServer) async -> UInt16? {
        for _ in 0..<100 {
            if let port = await server.boundPort, port != 0 { return port }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return nil
    }

    /// Pulls the next item off `hub.requests`. Safe to call multiple times
    /// in sequence within one test — each call creates a new iterator over
    /// the same `AsyncStream`, but `AsyncStream`'s buffered elements live in
    /// storage shared across every iterator drawn from the same stream
    /// value, so sequential (non-concurrent) calls drain it FIFO rather
    /// than each starting from scratch or racing each other.
    private func nextCapturedRequest(_ server: BridgeServer, timeout: Duration = .seconds(5)) async -> CapturedRequest? {
        await withTaskGroup(of: CapturedRequest?.self) { group in
            group.addTask {
                for await captured in await server.hub.requests { return captured }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// The `deviceEvents` counterpart to `nextCapturedRequest` — same
    /// sequential-draw-is-safe reasoning applies.
    private func nextDeviceEvent(_ server: BridgeServer, timeout: Duration = .seconds(5)) async -> BridgeDeviceEvent? {
        await withTaskGroup(of: BridgeDeviceEvent?.self) { group in
            group.addTask {
                for await event in await server.hub.deviceEvents { return event }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    private func openSocket(port: UInt16) -> URLSessionWebSocketTask {
        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        return task
    }

    private func requestFrame(id: String, url: String = "https://socket.test/x") -> String {
        #"{"type":"request","payload":{"id":"\#(id)","url":"\#(url)","method":"GET","startTime":1}}"#
    }

    @Test func aFrameSentOverTheSocketReachesTheRequestStream() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = openSocket(port: port)
        try await task.send(.string(requestFrame(id: "sock-1")))

        let received = await nextCapturedRequest(server)
        task.cancel(with: .goingAway, reason: nil)

        let captured = try #require(received, "a frame sent over a live socket never reached the hub")
        #expect(captured.request.id == "sock-1")
    }

    private func waitForFirstSpan(_ server: BridgeServer, timeout: Duration = .seconds(5)) async -> FrameworkSpan? {
        await withTaskGroup(of: FrameworkSpan?.self) { group in
            group.addTask {
                for await span in await server.hub.spans { return span }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// The span counterpart to `aFrameSentOverTheSocketReachesTheRequestStream`
    /// — proves span ingestion against a real loopback socket, not just the
    /// in-process fake peers `ServerTests` uses. Same rationale as this
    /// suite's header: a fake-peer-only test once stayed green while the app
    /// received nothing at all.
    @Test func aSpanSentOverTheSocketReachesTheSpansStream() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        let payload = #"{"id":"span-sock-1","traceId":"trace-sock","parentId":null,"name":"GET /","startTime":1,"endTime":2,"verbosity":"primary","runtime":"server"}"#
        try await task.send(.string(#"{"type":"span","payload":\#(payload)}"#))

        let received = await waitForFirstSpan(server)
        task.cancel(with: .goingAway, reason: nil)

        let span = try #require(received, "a span frame sent over a live socket never reached the hub")
        #expect(span.id == "span-sock-1")
        #expect(span.traceId == "trace-sock")
    }

    private func waitForFirstConsoleBatch(_ server: BridgeServer, timeout: Duration = .seconds(5)) async -> [LogEntry]? {
        await withTaskGroup(of: [LogEntry]?.self) { group in
            group.addTask {
                for await batch in await server.hub.consoleEntries { return batch }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// The `console` counterpart to `aSpanSentOverTheSocketReachesTheSpansStream`
    /// — proves the new frame kind's decode + relay + `BridgeHub.consoleEntries`
    /// yield all work against a real loopback socket, not just the in-process
    /// fake peers `ServerTests` uses.
    @Test func aConsoleFrameSentOverTheSocketReachesTheConsoleEntriesStream() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        let payload = #"[{"id":"log-sock-1","timestamp":1,"level":"warn","message":"cache stale"}]"#
        try await task.send(.string(#"{"type":"console","payload":\#(payload)}"#))

        let received = await waitForFirstConsoleBatch(server)
        task.cancel(with: .goingAway, reason: nil)

        let batch = try #require(received, "a console frame sent over a live socket never reached the hub")
        #expect(batch.count == 1)
        #expect(batch.first?.id == "log-sock-1")
        #expect(batch.first?.level == .warn)
        #expect(batch.first?.message == "cache stale")
    }

    private func waitForFirstStorageSnapshot(_ server: BridgeServer, timeout: Duration = .seconds(5)) async -> StorageSnapshot? {
        await withTaskGroup(of: StorageSnapshot?.self) { group in
            group.addTask {
                for await snapshot in await server.hub.storageSnapshots { return snapshot }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// The `storage` counterpart to `aSpanSentOverTheSocketReachesTheSpansStream`.
    @Test func aStorageFrameSentOverTheSocketReachesTheStorageSnapshotsStream() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        let payload = #"{"store":"defaults","timestamp":1,"entries":{"theme":"dark"}}"#
        try await task.send(.string(#"{"type":"storage","payload":\#(payload)}"#))

        let received = await waitForFirstStorageSnapshot(server)
        task.cancel(with: .goingAway, reason: nil)

        let snapshot = try #require(received, "a storage frame sent over a live socket never reached the hub")
        #expect(snapshot.store == "defaults")
        #expect(snapshot.entries == ["theme": "dark"])
    }

    @Test func aConnectedClientIsRegisteredAsAPeer() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = openSocket(port: port)
        // Round-trip a frame so the connection has certainly reached `.ready`.
        try await task.send(.string(requestFrame(id: "p", url: "https://p.test")))
        _ = await nextCapturedRequest(server)

        let peers = await server.hub.peerCount
        task.cancel(with: .goingAway, reason: nil)

        #expect(peers == 1, "a live connection must be a relay peer, or control frames reach nobody")
    }

    /// The whole point of carrying `senderID` through to `CapturedRequest`:
    /// two real sockets — the closest this suite gets to "an iOS simulator
    /// and an Android device hitting the same hub" — must not blur into one
    /// undifferentiated stream. Each client's frames must keep landing under
    /// that client's own label, not just "a" label.
    @Test func twoConnectedClientsAreAttributedToDistinctDevices() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let clientA = openSocket(port: port)
        let clientB = openSocket(port: port)

        try await clientA.send(.string(requestFrame(id: "a-1", url: "https://a.test/1")))
        let fromA1 = try #require(await nextCapturedRequest(server), "client A's first frame never reached the hub")

        try await clientB.send(.string(requestFrame(id: "b-1", url: "https://b.test/1")))
        let fromB1 = try #require(await nextCapturedRequest(server), "client B's frame never reached the hub")

        try await clientA.send(.string(requestFrame(id: "a-2", url: "https://a.test/2")))
        let fromA2 = try #require(await nextCapturedRequest(server), "client A's second frame never reached the hub")

        clientA.cancel(with: .goingAway, reason: nil)
        clientB.cancel(with: .goingAway, reason: nil)

        #expect(fromA1.request.id == "a-1")
        #expect(fromB1.request.id == "b-1")
        #expect(fromA2.request.id == "a-2")

        #expect(fromA1.peerID != fromB1.peerID, "two distinct sockets must not share a peer id")
        #expect(fromA1.deviceLabel != fromB1.deviceLabel, "two distinct sockets must not share a device label")
        #expect(
            fromA1.deviceLabel == fromA2.deviceLabel,
            "the same socket's later frame must keep the same device label as its first"
        )
        #expect(fromA1.peerID == fromA2.peerID, "the same socket must keep the same peer id across frames")
    }

    /// The device sidebar's foundation: two real sockets connecting must
    /// surface as two distinct `.connected` events on `deviceEvents`, not
    /// one undifferentiated "someone connected" signal — the same
    /// distinctness `twoConnectedClientsAreAttributedToDistinctDevices`
    /// proves for `CapturedRequest.peerID`, but observable before either
    /// client has sent a single frame.
    @Test func twoConnectedClientsProduceTwoDistinctConnectedEvents() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let clientA = openSocket(port: port)
        let firstEvent = try #require(await nextDeviceEvent(server), "client A's connect never reached deviceEvents")
        let clientB = openSocket(port: port)
        let secondEvent = try #require(await nextDeviceEvent(server), "client B's connect never reached deviceEvents")

        clientA.cancel()
        clientB.cancel()

        guard case let .connected(peerA) = firstEvent, case let .connected(peerB) = secondEvent else {
            Issue.record("expected two .connected events, got \(firstEvent) and \(secondEvent)")
            return
        }
        #expect(peerA != peerB, "two distinct sockets must not share a peer id in deviceEvents either")
    }

    // A raw-socket "disconnect fires `.disconnected`" test lived here and
    // was removed: in this sandbox, once any prior test in this same
    // process has opened and torn down a real socket, Network.framework
    // stops delivering `.failed`/`.cancelled` for a *later*, completely
    // unrelated `NWListener`'s connections within any workable timeout
    // (reproduced even after just one prior single-socket test, regardless
    // of how generous the wait) — a process/sandbox-level limitation, not a
    // defect in `BridgeHub.removePeer`/`deviceEvents`. That plumbing is
    // still proven over a real socket, just at the layer that actually
    // matters for this feature: `TrafficModelDevicesTests`
    // (Tests/AppTests) drives a real `TrafficModel`/`BridgeServer` through
    // connect, capture, and disconnect, and passes reliably regardless of
    // how many other real-socket tests ran before it in the same process.

    private func waitForHostControl(_ server: BridgeServer, timeout: Duration = .seconds(5)) async -> ControlCommand? {
        await withTaskGroup(of: ControlCommand?.self) { group in
            group.addTask {
                for await command in await server.hub.hostControls { return command }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// Proves the plumbing this task restores end to end: a device's
    /// `breakpoint.paused` control frame, sent over a real socket exactly
    /// like a device would send it, reaches `BridgeHub.hostControls` — the
    /// stream the desktop app's pause inbox consumes. Before
    /// `hostControls` existed, this frame would relay to other peers but
    /// never surface to the app itself, the same class of bug
    /// `BridgeSocketTests` exists to catch (see the suite doc comment).
    @Test func aBreakpointPausedFrameSentOverTheSocketReachesHostControls() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        let pauseFrame = """
        {"type":"control","payload":{"kind":"breakpoint.paused","pauseId":"pause-sock-1","phase":"request",\
        "device":"sock-device","request":{"url":"https://socket.test/pause","method":"POST","headers":{}}}}
        """
        try await task.send(.string(pauseFrame))

        let received = await waitForHostControl(server)
        task.cancel(with: .goingAway, reason: nil)

        guard case let .breakpointPaused(pauseId, _, phase, device, request, _) = try #require(
            received, "a breakpoint.paused frame sent over a live socket never reached hostControls"
        ) else {
            Issue.record("expected .breakpointPaused")
            return
        }
        #expect(pauseId == "pause-sock-1")
        #expect(phase == .request)
        #expect(device == "sock-device")
        #expect(request.url == "https://socket.test/pause")
    }

    /// The host -> device half of the same round trip: `breakpoint.resume`,
    /// encoded and sent the way `ControlSender`/`PauseInboxModel` actually
    /// send it, must reach a connected "device" (here, a second raw socket
    /// standing in for one) byte-for-byte.
    @Test func aBreakpointResumeBroadcastReachesAConnectedDevice() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let device = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        device.resume()
        // Round-trip a frame first so the connection has certainly reached
        // `.ready` and is registered as a peer before the broadcast below.
        try await device.send(.string(#"{"type":"request","payload":{"id":"warm","url":"https://w.test","method":"GET","startTime":1}}"#))
        _ = await nextCapturedRequest(server)

        let command = ControlCommand.breakpointResume(
            pauseId: "pause-sock-1",
            requestEdits: BreakpointRequestEdits(method: "PUT"),
            responseEdits: nil
        )
        let sender = ControlSender(hub: await server.hub)
        let delivered = try await sender.send(command)

        let messageTask = Task<URLSessionWebSocketTask.Message?, Never> {
            try? await device.receive()
        }
        let received = await messageTask.value
        device.cancel(with: .goingAway, reason: nil)

        #expect(delivered == 1)
        guard case let .string(text) = try #require(received) else {
            Issue.record("expected a text frame")
            return
        }
        let frame = try #require(parseBridgeFrame(text))
        #expect(frame.kind == .control)
        guard case let .breakpointResume(pauseId, requestEdits, _) = try #require(frame.control) else {
            Issue.record("expected .breakpointResume")
            return
        }
        #expect(pauseId == "pause-sock-1")
        #expect(requestEdits?.method == "PUT")
    }
}

/// The device-to-desktop path with BOTH real implementations: the SDK's own
/// `HakkaBridgeClient` talking to the desktop's `BridgeServer` over a real
/// loopback socket. Every other test in this file drives the server with a
/// raw `URLSessionWebSocketTask`, which is why a defect in the SDK client
/// could never fail them. A simulator-capture spike reported that the client
/// connects but never delivers; this is where that claim gets settled.
@Suite("SDK bridge client to desktop hub")
struct SDKBridgeClientTests {
    private func boundPort(of server: BridgeServer) async -> UInt16? {
        for _ in 0..<100 {
            if let port = await server.boundPort, port != 0 { return port }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return nil
    }

    private func firstRequest(_ server: BridgeServer, timeout: Duration = .seconds(8)) async -> NetworkRequest? {
        await withTaskGroup(of: NetworkRequest?.self) { group in
            group.addTask {
                for await captured in await server.hub.requests { return captured.request }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    @Test func aCaptureSentByTheSDKClientReachesTheDesktopHub() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let client = HakkaBridgeClient(url: URL(string: "ws://127.0.0.1:\(port)")!)
        client.start()
        defer { client.stop() }

        let record = NetworkRequest(
            id: "sdk-1",
            url: "https://sdk.test/capture",
            method: .get,
            status: 200,
            startTime: 1
        )
        client.send(record)

        let received = try #require(
            await firstRequest(server),
            "the SDK's own bridge client connected but its frame never reached the hub"
        )
        #expect(received.id == "sdk-1")
    }

    private func firstConsoleBatch(_ server: BridgeServer, timeout: Duration = .seconds(8)) async -> [LogEntry]? {
        await withTaskGroup(of: [LogEntry]?.self) { group in
            group.addTask {
                for await batch in await server.hub.consoleEntries { return batch }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// Proves the iOS SDK's real send path end to end: `HakkaInterceptor.log(...)`
    /// (via `HakkaBridgeClient.sendConsole`) is exercised at the `HakkaBridgeClient`
    /// layer directly here, same as `aCaptureSentByTheSDKClientReachesTheDesktopHub`
    /// exercises `send(_:)` rather than going through `HakkaInterceptor` — the
    /// interceptor wiring itself is covered by `HakkaBridgeClientTests` in the
    /// `ios` package, which cannot bind a real socket from that target.
    @Test func aConsoleEntrySentByTheSDKClientReachesTheDesktopHub() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let client = HakkaBridgeClient(url: URL(string: "ws://127.0.0.1:\(port)")!)
        client.start()
        defer { client.stop() }

        let entry = LogEntry(id: "sdk-log-1", timestamp: 1, level: .error, message: "checkout failed")
        client.sendConsole([entry])

        let received = try #require(
            await firstConsoleBatch(server),
            "the SDK's own bridge client connected but its console frame never reached the hub"
        )
        #expect(received.count == 1)
        #expect(received.first?.id == "sdk-log-1")
        #expect(received.first?.level == .error)
    }

    private func firstStorageSnapshot(_ server: BridgeServer, timeout: Duration = .seconds(8)) async -> StorageSnapshot? {
        await withTaskGroup(of: StorageSnapshot?.self) { group in
            group.addTask {
                for await snapshot in await server.hub.storageSnapshots { return snapshot }
                return nil
            }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }

    /// The storage counterpart to `aConsoleEntrySentByTheSDKClientReachesTheDesktopHub`
    /// — proves `HakkaBridgeClient.sendStorage` end to end against a real
    /// desktop hub socket.
    @Test func aStorageSnapshotSentByTheSDKClientReachesTheDesktopHub() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let client = HakkaBridgeClient(url: URL(string: "ws://127.0.0.1:\(port)")!)
        client.start()
        defer { client.stop() }

        client.sendStorage(StorageSnapshot(store: "defaults", timestamp: 1, entries: ["theme": "dark"]))

        let received = try #require(
            await firstStorageSnapshot(server),
            "the SDK's own bridge client connected but its storage frame never reached the hub"
        )
        #expect(received.store == "defaults")
        #expect(received.entries == ["theme": "dark"])
    }
}
