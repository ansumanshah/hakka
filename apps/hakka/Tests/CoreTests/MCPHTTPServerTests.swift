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
}
