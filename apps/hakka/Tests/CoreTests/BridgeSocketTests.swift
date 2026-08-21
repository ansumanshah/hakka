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
