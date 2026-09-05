import Darwin
import Foundation
import Testing

@testable import HakkaServer

/// The one path the JSON-RPC-handler tests can't cover: a real socket.
/// `MCPRequestHandlerTests` drives `MCPRequestHandler.handle` directly with
/// no networking at all — this suite exists only to prove the HTTP glue
/// around it (binding, an actual POST, the JSON-RPC body making the round
/// trip) actually works, matching `BridgeSocketTests`' rationale for why a
/// no-socket test suite alone isn't enough proof.
///
/// Loopback only, ephemeral port. Nothing here reaches the network.
@Suite("MCP over a real HTTP socket")
struct MCPHTTPServerTests {
    private func startServer() async throws -> (server: MCPHTTPServer, port: UInt16) {
        let handler = MCPRequestHandler(registry: MCPToolRegistry())
        let server = MCPHTTPServer(handler: handler, port: 0)
        let port = try await server.start()
        return (server, port)
    }

    private func post(port: UInt16, body: String) async throws -> (status: Int, data: Data) {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        let (data, response) = try await URLSession.shared.data(for: request)
        let http = try #require(response as? HTTPURLResponse)
        return (http.statusCode, data)
    }

    @Test("start() binds loopback and reports back a real, non-zero port")
    func startBindsAndReportsPort() async throws {
        let (server, port) = try await startServer()
        defer { Task { await server.stop() } }
        #expect(port != 0)
        #expect(await server.boundPort == port)
        #expect(await server.isRunning)
    }

    @Test("a real POST round-trips through the JSON-RPC handler")
    func realPOSTRoundTrips() async throws {
        let (server, port) = try await startServer()
        defer { Task { await server.stop() } }

        let (status, data) = try await post(port: port, body: #"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#)
        #expect(status == 200)
        let response = try JSONDecoder().decode(MCPValue.self, from: data)
        #expect(response["id"] == .number(1))
        #expect(response["result"]?["tools"] == .array([]))
    }

    @Test("a notification (no id) gets a 202 with an empty body over the real socket")
    func notificationOverSocketGets202() async throws {
        let (server, port) = try await startServer()
        defer { Task { await server.stop() } }

        let (status, data) = try await post(port: port, body: #"{"jsonrpc":"2.0","method":"notifications/initialized"}"#)
        #expect(status == 202)
        #expect(data.isEmpty)
    }

    @Test("stop() closes the listener")
    func stopClosesListener() async throws {
        let (server, _) = try await startServer()
        await server.stop()
        #expect(await server.isRunning == false)
        #expect(await server.boundPort == nil)
    }
    @Test("a fixed port already in use fails before reporting the server running")
    func occupiedFixedPortFailsStartup() async throws {
        let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        #expect(socket >= 0)
        defer { Darwin.close(socket) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        #expect(bound == 0)
        #expect(Darwin.listen(socket, 1) == 0)
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let inspected = withUnsafeMutablePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(socket, $0, &length) }
        }
        #expect(inspected == 0)
        let handler = MCPRequestHandler(registry: MCPToolRegistry())
        let server = MCPHTTPServer(handler: handler, port: UInt16(bigEndian: address.sin_port))
        await #expect(throws: (any Error).self) { try await server.start() }
        #expect(await server.isRunning == false)
        #expect(await server.boundPort == nil)
        await server.stop()
    }

    @Test("stop revokes a connected client that has not sent its request yet")
    func stopClosesAcceptedConnections() async throws {
        let (server, port) = try await startServer()
        defer { Task { await server.stop() } }
        let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        #expect(socket >= 0)
        defer { Darwin.close(socket) }
        var noSignal: Int32 = 1
        _ = setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size))
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        _ = setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        #expect(connected == 0)
        for _ in 0..<200 {
            if await server.activeConnectionCount == 1 { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        try #require(await server.activeConnectionCount == 1)
        await server.stop()

        let body = #"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#
        let request = Data("POST / HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)".utf8)
        let received: Int = await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                _ = request.withUnsafeBytes { Darwin.send(socket, $0.baseAddress, $0.count, 0) }
                var buffer = [UInt8](repeating: 0, count: 128)
                continuation.resume(returning: Darwin.recv(socket, &buffer, buffer.count, 0))
            }
        }
        #expect(received <= 0, "disabled MCP must close already accepted clients before they can request data")
        #expect(await server.activeConnectionCount == 0)
    }

}
