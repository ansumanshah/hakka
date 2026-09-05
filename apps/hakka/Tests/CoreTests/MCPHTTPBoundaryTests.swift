import Darwin
import Foundation
import Testing

@testable import HakkaServer

@Suite("MCP HTTP local access boundary")
struct MCPHTTPBoundaryTests {
    private func exchange(port: UInt16, headers: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global().async {
                do { continuation.resume(returning: try exchangeSynchronously(port: port, headers: headers)) }
                catch { continuation.resume(throwing: error) }
            }
        }
    }

    private func exchangeSynchronously(port: UInt16, headers: String) throws -> String {
        let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else { throw POSIXError(.EIO) }
        defer { Darwin.close(socket) }
        var timeout = timeval(tv_sec: 3, tv_usec: 0)
        setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
        var noSignal: Int32 = 1
        setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout.size(ofValue: noSignal)))
        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard connected == 0 else { throw POSIXError(.ECONNREFUSED) }
        let body = #"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#
        let data = Data("POST / HTTP/1.1\r\n\(headers)Content-Length: \(body.utf8.count)\r\n\r\n\(body)".utf8)
        let sent = data.withUnsafeBytes { Darwin.send(socket, $0.baseAddress, $0.count, 0) }
        guard sent == data.count else { throw POSIXError(.EIO) }
        var buffer = [UInt8](repeating: 0, count: 4096)
        let count = Darwin.recv(socket, &buffer, buffer.count, 0)
        guard count > 0 else { throw POSIXError(.ETIMEDOUT) }
        return String(decoding: buffer.prefix(count), as: UTF8.self)
    }

    @Test("browser origins and rebound hosts are forbidden", arguments: [
        "Host: localhost\r\nOrigin: https://evil.example\r\n",
        "Host: localhost\r\nOrigin: null\r\n",
        "Host: localhost\r\nOrigin: http://localhost\r\n",
        "Host: evil.example\r\n",
        "Host: localhost.evil.example\r\n",
        "Host: localhost:0\r\n",
        "Host: localhost:65536\r\n",
        "Host: localhost:abc\r\n",
        "Host: localhost\r\nHost: evil.example\r\n",
        "",
    ])
    func rejectsUntrustedRequests(headers: String) async throws {
        let server = MCPHTTPServer(handler: MCPRequestHandler(registry: MCPToolRegistry()), port: 0)
        let port = try await server.start()
        defer { Task { await server.stop() } }
        let response = try await exchange(port: port, headers: headers)
        #expect(response.hasPrefix("HTTP/1.1 403 Forbidden"))
    }

    @Test("native no-Origin requests with loopback hosts still work", arguments: ["localhost", "127.0.0.1", "[::1]"])
    func acceptsNativeClient(host: String) async throws {
        let server = MCPHTTPServer(handler: MCPRequestHandler(registry: MCPToolRegistry()), port: 0)
        let port = try await server.start()
        defer { Task { await server.stop() } }
        let response = try await exchange(port: port, headers: "Host: \(host):\(port)\r\n")
        #expect(response.hasPrefix("HTTP/1.1 200 OK"))
    }
}
