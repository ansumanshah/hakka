import Foundation
import HakkaCommon
import Testing
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
}
