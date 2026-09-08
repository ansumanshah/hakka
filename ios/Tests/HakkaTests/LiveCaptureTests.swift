import Foundation
import Network
import Testing
@testable import HakkaNetwork
import HakkaCommon

// MARK: - MiniHTTPServer

/// A minimal single-response HTTP/1.1 server over loopback TCP.
///
/// Exists so `LiveCaptureTests` can prove `HakkaInterceptor` captures a
/// genuine network round trip end to end. The rest of the suite (see
/// `URLProtocolEdgeTests`) drives `HakkaURLProtocol`'s `URLSessionDataDelegate`
/// callbacks directly, which proves the parsing/redaction logic but never
/// proves the OS actually routes a real `URLSession` request through the
/// registered protocol and swizzled session configuration on this platform.
final class MiniHTTPServer: @unchecked Sendable {
    enum ServerError: Error { case startFailed, portUnavailable }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.tests.mini-http-server")
    private let lock = NSLock()
    private var connections: [NWConnection] = []
    private var latestRequestBody = Data()

    init() throws {
        listener = try NWListener(using: .tcp, on: .any)
    }

    /// Starts listening and returns the assigned loopback port. Blocks the
    /// calling thread briefly (bounded) until the listener reports `.ready`.
    func start() throws -> UInt16 {
        let semaphore = DispatchSemaphore(value: 0)

        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready, .failed:
                semaphore.signal()
            default:
                break
            }
        }
        listener.start(queue: queue)

        guard semaphore.wait(timeout: .now() + 5) == .success else {
            throw ServerError.startFailed
        }
        guard case .ready = listener.state, let port = listener.port?.rawValue else {
            throw ServerError.portUnavailable
        }
        return port
    }

    func stop() {
        listener.cancel()
        lock.lock()
        let live = connections
        connections.removeAll()
        lock.unlock()
        live.forEach { $0.cancel() }
    }

    func receivedRequestBody() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return latestRequestBody
    }

    private func accept(_ connection: NWConnection) {
        lock.lock()
        connections.append(connection)
        lock.unlock()
        connection.start(queue: queue)
        receive(connection, buffered: Data())
    }

    /// Reads the complete fixed-length request, then replies with a fixed 200 response.
    private func receive(_ connection: NWConnection, buffered: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var accumulated = buffered
            if let data { accumulated.append(data) }
            let terminator = Data("\r\n\r\n".utf8)
            if let headerRange = accumulated.range(of: terminator) {
                let headers = String(decoding: accumulated[..<headerRange.lowerBound], as: UTF8.self)
                let contentLength = headers.split(separator: "\r\n").first { line in
                    line.lowercased().hasPrefix("content-length:")
                }.flatMap { line in
                    Int(line.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces))
                } ?? 0
                let bodyStart = headerRange.upperBound
                guard accumulated.count >= bodyStart + contentLength else {
                    if error == nil, !isComplete {
                        self.receive(connection, buffered: accumulated)
                    }
                    return
                }
                self.lock.lock()
                self.latestRequestBody = accumulated.subdata(in: bodyStart..<(bodyStart + contentLength))
                self.lock.unlock()
                self.respond(connection)
            } else if error == nil, !isComplete {
                self.receive(connection, buffered: accumulated)
            }
        }
    }

    private func respond(_ connection: NWConnection) {
        let body = "pong"
        let response = "HTTP/1.1 200 OK\r\n"
            + "Content-Type: text/plain\r\n"
            + "Content-Length: \(body.utf8.count)\r\n"
            + "Connection: close\r\n\r\n\(body)"
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

// MARK: - LiveCaptureTests

@Suite("Live capture (real localhost round trip)", .serialized)
struct LiveCaptureTests {
    /// Proves `HakkaInterceptor` captures a genuine `URLSession` request made
    /// against a real (loopback) server — not a fake delegate callback — on
    /// whatever platform this test target runs on. This is the check that
    /// distinguishes "the capture target compiles" from "the capture target
    /// actually captures", which is the whole point of extending platform
    /// support: a build-only pass would happily ship a target that links but
    /// never intercepts a byte.
    @Test func capturesRealLocalhostRequest() async throws {
        let server = try MiniHTTPServer()
        let port = try server.start()
        defer { server.stop() }

        let interceptor = HakkaInterceptor()
        interceptor.start()
        defer { interceptor.stop() }

        let session = URLSession(configuration: .default)
        let url = try #require(URL(string: "http://127.0.0.1:\(port)/ping"))
        let (data, response) = try await session.data(from: url)

        let http = try #require(response as? HTTPURLResponse)
        #expect(http.statusCode == 200)
        #expect(String(data: data, encoding: .utf8) == "pong")

        let deadline = Date().addingTimeInterval(5)
        var captured: NetworkRequest?
        while captured == nil, Date() < deadline {
            captured = interceptor.store.requests.first { $0.url.contains("127.0.0.1:\(port)/ping") }
            if captured == nil {
                try await Task.sleep(nanoseconds: 20_000_000)
            }
        }

        let request = try #require(captured, "HakkaInterceptor never captured the real request")
        #expect(request.status == 200)
        #expect(request.method == .get)
        #expect(request.source == .urlSession)
    }

    @Test func capturesRealPostBodyWithoutChangingWireBytes() async throws {
        let server = try MiniHTTPServer()
        let port = try server.start()
        defer { server.stop() }

        let interceptor = HakkaInterceptor(config: HakkaConfig(sensitiveBodyFields: ["token"]))
        interceptor.start()
        defer { interceptor.stop() }

        let body = Data(#"{"source":"react-native-example","token":"secret"}"#.utf8)
        var request = URLRequest(url: try #require(URL(string: "http://127.0.0.1:\(port)/post")))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        let session = URLSession(configuration: .default)
        let (data, response) = try await session.data(for: request)

        let http = try #require(response as? HTTPURLResponse)
        #expect(http.statusCode == 200)
        #expect(String(data: data, encoding: .utf8) == "pong")
        #expect(server.receivedRequestBody() == body)

        let deadline = Date().addingTimeInterval(5)
        var captured: NetworkRequest?
        while captured == nil, Date() < deadline {
            captured = interceptor.store.requests.first { $0.url.contains("127.0.0.1:\(port)/post") }
            if captured == nil {
                try await Task.sleep(nanoseconds: 20_000_000)
            }
        }

        let capturedRequest = try #require(captured, "HakkaInterceptor never captured the real POST")
        #expect(capturedRequest.method == .post)
        #expect(capturedRequest.requestBodySize == Int64(body.count))
        let capturedJSON = try #require(capturedRequest.requestBody?.data(using: .utf8))
        let capturedObject = try #require(JSONSerialization.jsonObject(with: capturedJSON) as? [String: String])
        #expect(capturedObject["source"] == "react-native-example")
        #expect(capturedObject["token"] == "██")
    }
}
