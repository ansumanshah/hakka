import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

// MARK: - Fakes

/// Drives `WebSocketCaptureSession` with no network: `push` yields an event
/// on the same stream the real `URLSessionWebSocketConnection` would, and
/// `sentTexts`/`closeCalls` record what the session did in response.
/// `@unchecked Sendable`: the only stored state past init is written from a
/// single test task and read after `await`ing the session has processed it
/// (via `session.changes`), so there is no concurrent access to race.
private final class FakeWebSocketConnection: WebSocketConnection, @unchecked Sendable {
    let events: AsyncStream<WebSocketConnectionEvent>
    private let continuation: AsyncStream<WebSocketConnectionEvent>.Continuation
    private(set) var sentTexts: [String] = []
    private(set) var closeCalls: [Int] = []
    var sendError: (any Error)?

    init() {
        var box: AsyncStream<WebSocketConnectionEvent>.Continuation?
        events = AsyncStream { box = $0 }
        continuation = box!
    }

    func push(_ event: WebSocketConnectionEvent) {
        continuation.yield(event)
    }

    func send(text: String) async throws {
        if let sendError { throw sendError }
        sentTexts.append(text)
    }

    func close(code: Int) {
        closeCalls.append(code)
    }
}

private struct FakeWebSocketTransport: WebSocketTransport {
    let connection: FakeWebSocketConnection

    func connect(url _: URL, protocols _: [String]) async -> any WebSocketConnection {
        connection
    }
}

private let testURL = URL(string: "wss://example.com/socket")!

/// Runs `session.changes` until a snapshot in `.closed` state arrives (every
/// test below ends the fake's event script with `.closed`), returning that
/// snapshot — it reflects every earlier mutation too, since the actor
/// processes the fake's pushed events strictly in order.
private func finalSnapshot(_ session: WebSocketCaptureSession) async -> WebSocketCaptureSnapshot {
    var last = WebSocketCaptureSnapshot.empty
    for await snapshot in session.changes {
        last = snapshot
        if case .closed = snapshot.state { break }
    }
    return last
}

// MARK: - Tests

@Suite("WebSocketCaptureSession")
struct WebSocketCaptureSessionTests {
    @Test func frameOrderIsPreserved() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.opened(wsProtocol: nil))
        let texts = ["one", "two", "three", "four"]
        for (index, text) in texts.enumerated() {
            fake.push(.frame(.capped(direction: .received, opcode: .text, text: text, bytes: nil, timestamp: Int64(index))))
        }
        fake.push(.closed(code: 1000, reason: nil))

        let snapshot = await finalSnapshot(session)
        #expect(snapshot.frames.map(\.payload) == texts.map { .text($0) })
    }

    @Test func perFramePayloadCapTruncatesButKeepsTheConnectionAlive() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.opened(wsProtocol: nil))

        let hugeText = String(repeating: "a", count: WebSocketCaps.perFramePayloadBytes + 1024)
        let oversized = WebSocketFrame.capped(direction: .received, opcode: .text, text: hugeText, bytes: nil, timestamp: 0)
        fake.push(.frame(oversized))
        let normal = WebSocketFrame.capped(direction: .received, opcode: .text, text: "ping", bytes: nil, timestamp: 1)
        fake.push(.frame(normal))
        fake.push(.closed(code: 1000, reason: nil))

        let snapshot = await finalSnapshot(session)
        #expect(snapshot.frames.count == 2, "the connection must keep working across an oversized frame")
        guard case let .byteCount(count) = snapshot.frames[0].payload else {
            Issue.record("an oversized frame must be capped to a byte count, not stored verbatim")
            return
        }
        #expect(count == hugeText.utf8.count)
        #expect(snapshot.frames[1].payload == .text("ping"), "a normal frame right after an oversized one must still be captured in full")
    }

    @Test func perConnectionFrameCapDropsPastLimitWithoutClosingTheConnection() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.opened(wsProtocol: nil))
        let overflow = 5
        let total = WebSocketCaps.perConnectionFrameCount + overflow
        for index in 0..<total {
            fake.push(.frame(.capped(direction: .received, opcode: .text, text: "\(index)", bytes: nil, timestamp: Int64(index))))
        }
        fake.push(.closed(code: 1000, reason: nil))

        let snapshot = await finalSnapshot(session)
        #expect(snapshot.frames.count == WebSocketCaps.perConnectionFrameCount, "storage must stop exactly at the cap")
        #expect(snapshot.droppedFrameCount == overflow, "frames past the cap are counted, not silently discarded")
        #expect(snapshot.totalFrameCount == total)
        #expect(snapshot.state == .closed(code: 1000), "hitting the frame cap must not tear down the connection")
    }

    /// `URLSessionWebSocketTask.cancel(with:reason:)` is a forceful cancel,
    /// not the close handshake, so nothing guarantees the transport ever
    /// confirms it. A manual disconnect must show `.closed` regardless.
    @Test func manualDisconnectSurfacesClosedEvenWithoutTransportConfirmation() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.opened(wsProtocol: nil))
        for await snapshot in session.changes where snapshot.state.isOpen { break }

        await session.disconnect(code: 1000)

        let snapshot = await finalSnapshot(session)
        #expect(snapshot.state == .closed(code: 1000))
        #expect(fake.closeCalls == [1000])
    }

    @Test func disconnectBeforeConnectingIsANoOp() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))

        await session.disconnect()

        #expect(fake.closeCalls.isEmpty)
    }

    @Test func closeCodeIsSurfaced() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.opened(wsProtocol: nil))
        fake.push(.closed(code: 1001, reason: "going away"))

        let snapshot = await finalSnapshot(session)
        #expect(snapshot.state == .closed(code: 1001))
    }

    @Test func failureIsSurfacedAsAState() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.failed("Could not connect to the server."))

        var last: WebSocketCaptureSnapshot?
        for await snapshot in session.changes {
            last = snapshot
            if case .failed = snapshot.state { break }
        }
        #expect(last?.state == .failed("Could not connect to the server."))
    }

    @Test func sendBeforeConnectingFailsCleanlyRatherThanHanging() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))

        await #expect(throws: WebSocketSessionError.notConnected) {
            try await session.send(text: "hello")
        }
        #expect(fake.sentTexts.isEmpty)
    }

    @Test func sendAfterCloseFailsCleanlyRatherThanHanging() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.opened(wsProtocol: nil))
        fake.push(.closed(code: 1000, reason: nil))
        _ = await finalSnapshot(session)

        await #expect(throws: WebSocketSessionError.notConnected) {
            try await session.send(text: "hello")
        }
        #expect(fake.sentTexts.isEmpty)
    }

    @Test func sendWhileOpenRecordsASentFrame() async throws {
        let fake = FakeWebSocketConnection()
        let session = WebSocketCaptureSession(transport: FakeWebSocketTransport(connection: fake))
        await session.connect(url: testURL)
        fake.push(.opened(wsProtocol: "chat"))
        // Wait for `.open` before sending — otherwise the send races the
        // pump task's processing of `.opened`.
        for await snapshot in session.changes where snapshot.state.isOpen { break }

        try await session.send(text: "hello")
        fake.push(.closed(code: 1000, reason: nil))

        let snapshot = await finalSnapshot(session)
        #expect(fake.sentTexts == ["hello"])
        #expect(snapshot.frames.contains { $0.direction == .sent && $0.payload == .text("hello") })
    }
}

@Suite("WebSocketURL")
struct WebSocketURLTests {
    @Test func recognizesWsAndWss() {
        #expect(WebSocketURL.isWebSocketURL("ws://localhost:8080") == true)
        #expect(WebSocketURL.isWebSocketURL("wss://api.example.com/socket") == true)
        #expect(WebSocketURL.isWebSocketURL("  WSS://api.example.com  ") == true)
    }

    @Test func rejectsHttp() {
        #expect(WebSocketURL.isWebSocketURL("https://api.example.com") == false)
        #expect(WebSocketURL.isWebSocketURL("") == false)
        #expect(WebSocketURL.isWebSocketURL("{{baseUrl}}/socket") == false)
    }
}
