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

    private func waitForFirstRequest(_ server: BridgeServer, timeout: Duration = .seconds(5)) async -> NetworkRequest? {
        await withTaskGroup(of: NetworkRequest?.self) { group in
            group.addTask {
                for await request in await server.hub.requests { return request }
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

    @Test func aFrameSentOverTheSocketReachesTheRequestStream() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        let payload = #"{"id":"sock-1","url":"https://socket.test/x","method":"GET","startTime":1}"#
        try await task.send(.string(#"{"type":"request","payload":\#(payload)}"#))

        let received = await waitForFirstRequest(server)
        task.cancel(with: .goingAway, reason: nil)

        let request = try #require(received, "a frame sent over a live socket never reached the hub")
        #expect(request.id == "sock-1")
    }

    @Test func aConnectedClientIsRegisteredAsAPeer() async throws {
        let server = BridgeServer(options: BridgeServerOptions(port: 0, advertise: false))
        try await server.start()
        let port = try #require(await boundPort(of: server))
        defer { Task { await server.stop() } }

        let task = URLSession.shared.webSocketTask(with: URL(string: "ws://127.0.0.1:\(port)")!)
        task.resume()
        // Round-trip a frame so the connection has certainly reached `.ready`.
        try await task.send(.string(#"{"type":"request","payload":{"id":"p","url":"https://p.test","method":"GET","startTime":1}}"#))
        _ = await waitForFirstRequest(server)

        let peers = await server.hub.peerCount
        task.cancel(with: .goingAway, reason: nil)

        #expect(peers == 1, "a live connection must be a relay peer, or control frames reach nobody")
    }
}
