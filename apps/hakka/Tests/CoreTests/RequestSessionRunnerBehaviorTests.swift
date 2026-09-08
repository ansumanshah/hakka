import Foundation
import Testing
@testable import HakkaCore

@Suite("RequestSessionRunner real transports", .serialized)
struct RequestSessionRunnerBehaviorTests {
    @Test func webSocketEchoesTextAndBinaryFrames() async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let record = await RequestSessionRunner().run(
            request(server.webSocketURL(path: "/ws")),
            session: .webSocket(WebSocketSessionSpec(
                sendFrames: [
                    WebSocketSessionFrame(data: "hello"),
                    WebSocketSessionFrame(data: "AQI=", isBinary: true),
                ],
                maxFrames: 2,
                timeoutMs: 2_000,
            )),
        )

        #expect(record.error == nil)
        #expect(record.status == 101)
        let body = try #require(record.responseBody)
        let json = try #require(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        let frames = try #require(json["frames"] as? [[String: Any]])
        #expect(frames.count == 2)
        #expect(frames[0]["data"] as? String == "hello")
        #expect(frames[0]["isBinary"] as? Bool == false)
        #expect(frames[1]["data"] as? String == "AQI=")
        #expect(frames[1]["isBinary"] as? Bool == true)
    }

    @Test func webSocketReportsEarlyPeerClose() async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let clock = ContinuousClock()
        let started = clock.now
        let record = await RequestSessionRunner().run(
            request(server.webSocketURL(path: "/ws-early")),
            session: .webSocket(WebSocketSessionSpec(
                sendFrames: [WebSocketSessionFrame(data: "one")], maxFrames: 2, timeoutMs: 2_000,
            )),
        )

        #expect(record.error != nil)
        #expect(started.duration(to: clock.now) < .seconds(1))
    }

    @Test func webSocketRejectsMoreThanFiveMiBOfOutgoingFrames() async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let oversized = String(repeating: "x", count: 5 * 1024 * 1024 + 1)
        let record = await RequestSessionRunner().run(
            request(server.webSocketURL(path: "/ws")),
            session: .webSocket(WebSocketSessionSpec(
                sendFrames: [WebSocketSessionFrame(data: oversized)], maxFrames: 1, timeoutMs: 2_000,
            )),
        )

        #expect(record.error?.contains("bodyTooLarge") == true)
    }

    @Test func sseParsesCommentsMultilineDataCRLFAndPersistentIDs() async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let record = await RequestSessionRunner().run(
            request(server.httpURL(path: "/sse")),
            session: .sse(SSESessionSpec(maxEvents: 2, timeoutMs: 2_000)),
        )

        #expect(record.error == nil)
        #expect(record.status == 200)
        let body = try #require(record.responseBody)
        let json = try #require(try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any])
        let events = try #require(json["events"] as? [[String: String]])
        #expect(events == [
            ["event": "message", "data": "first\nsecond  ", "id": "4"],
            ["event": "update", "data": "final", "id": "4"],
        ])
    }

    @Test func sseRejectsAnOversizedLineWithoutAFieldDelimiter() async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let record = await RequestSessionRunner().run(
            request(server.httpURL(path: "/sse-large-line")),
            session: .sse(SSESessionSpec(maxEvents: 1, timeoutMs: 10_000)),
        )

        #expect(record.error?.contains("bodyTooLarge") == true)
    }

    @Test(arguments: ["/stall-headers", "/stall-body"])
    func wholeSessionDeadlineCancelsHeaderAndBodyStalls(path: String) async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let clock = ContinuousClock()
        let started = clock.now
        let record = await RequestSessionRunner().run(
            request(server.httpURL(path: path)),
            session: .sse(SSESessionSpec(maxEvents: 1, timeoutMs: 80)),
        )

        #expect(record.error?.contains("timeout") == true)
        #expect(started.duration(to: clock.now) < .seconds(1))
    }

    @Test func parentCancellationDoesNotWaitForTheSessionDeadline() async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let runner = RequestSessionRunner()
        let url = server.httpURL(path: "/stall-body")
        let clock = ContinuousClock()
        let task = Task {
            await runner.run(request(url), session: .sse(SSESessionSpec(maxEvents: 1, timeoutMs: 30_000)))
        }
        try await Task.sleep(for: .milliseconds(50))
        let cancelledAt = clock.now
        task.cancel()
        let record = await task.value

        #expect(record.error != nil)
        #expect(cancelledAt.duration(to: clock.now) < .seconds(1))
    }

    @Test func sseReportsAnEarlyClose() async throws {
        let server = try await LocalSessionServer.start()
        defer { server.stop() }
        let record = await RequestSessionRunner().run(
            request(server.httpURL(path: "/sse-early")),
            session: .sse(SSESessionSpec(maxEvents: 1, timeoutMs: 2_000)),
        )

        #expect(record.error?.contains("endedEarly") == true)
    }

    private func request(_ url: URL) -> ResolvedRequest {
        ResolvedRequest(
            requestId: UUID().uuidString,
            name: "Session transport test",
            method: .get,
            url: url,
            headers: [:],
            body: .none,
            timeout: nil,
            followRedirects: true,
        )
    }
}

private final class LocalSessionServer: @unchecked Sendable {
    private let process: Process
    private let output: Pipe
    let port: Int

    private init(process: Process, output: Pipe, port: Int) {
        self.process = process
        self.output = output
        self.port = port
    }

    static func start() async throws -> LocalSessionServer {
        let output = Pipe()
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["bun", "-e", serverScript]
        process.currentDirectoryURL = repositoryRoot().appendingPathComponent("packages/hakka-cli")
        process.standardOutput = output
        process.standardError = Pipe()
        try process.run()

        let reader = BlockingLineReader(output.fileHandleForReading)
        let line = try await Task.detached { try reader.readLine() }.value
        guard let port = Int(line) else {
            process.terminate()
            throw LocalSessionServerError.invalidPort(line)
        }
        return LocalSessionServer(process: process, output: output, port: port)
    }

    func httpURL(path: String) -> URL {
        URL(string: "http://127.0.0.1:\(port)\(path)")!
    }

    func webSocketURL(path: String) -> URL {
        URL(string: "ws://127.0.0.1:\(port)\(path)")!
    }

    func stop() {
        guard process.isRunning else { return }
        process.terminate()
    }

    private static func repositoryRoot() -> URL {
        var candidate = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while candidate.path != "/" {
            if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("package.json").path) {
                return candidate
            }
            candidate.deleteLastPathComponent()
        }
        return URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    }

    private static let serverScript = #"""
        import { createServer } from "node:http";
        import { WebSocketServer } from "ws";

        const server = createServer((request, response) => {
          if (request.url === "/stall-headers") return;
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.flushHeaders();
          if (request.url === "/stall-body") return;
          if (request.url === "/sse-large-line") {
            response.write("malformed" + "x".repeat(5 * 1024 * 1024 + 1));
            return;
          }
          if (request.url === "/sse-early") {
            response.end(": heartbeat\n\ndata: unfinished");
            return;
          }
          response.write(": heartbeat\r");
          setTimeout(() => response.write("\n\r\nid: 4\r"), 5);
          setTimeout(() => response.write("\ndata: first\r\ndata: second  \r\n\r\n"), 10);
          setTimeout(() => response.end("event: update\rdata: final\r\r"), 15);
        });

        const sockets = new WebSocketServer({ server });
        sockets.on("connection", (socket, request) => {
          if (request.url === "/ws-early") {
            socket.once("message", (data, isBinary) => {
              socket.send(data, { binary: isBinary }, () => socket.close());
            });
            return;
          }
          socket.on("message", (data, isBinary) => socket.send(data, { binary: isBinary }));
        });

        server.listen(0, "127.0.0.1", () => console.log(server.address().port));
        process.on("SIGTERM", () => {
          for (const socket of sockets.clients) socket.terminate();
          server.closeAllConnections();
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 50).unref();
        });
        """#
}

private final class BlockingLineReader: @unchecked Sendable {
    private let handle: FileHandle

    init(_ handle: FileHandle) {
        self.handle = handle
    }

    func readLine() throws -> String {
        var bytes = Data()
        while true {
            guard let byte = try handle.read(upToCount: 1), !byte.isEmpty else {
                throw LocalSessionServerError.endedBeforePort
            }
            if byte[byte.startIndex] == 10 { break }
            bytes.append(byte)
        }
        return String(decoding: bytes, as: UTF8.self)
    }
}

private enum LocalSessionServerError: Error {
    case endedBeforePort
    case invalidPort(String)
}
