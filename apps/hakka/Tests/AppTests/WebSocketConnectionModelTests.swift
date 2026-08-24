import Foundation
import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// Same fake shape as `WebSocketCaptureSessionTests`' — the App-target tests
/// need their own copy since the Core-target fake is file-private there.
/// Not actor-isolated (same as the Core fake): the only stored state is
/// written from `push`/`send`, both called sequentially from the test's
/// `@MainActor` context or the model's internal `Task`s, and read only after
/// `waitUntil` confirms the mirror caught up — nothing races it in practice,
/// hence `@unchecked Sendable`.
private final class FakeWebSocketConnection: WebSocketConnection, @unchecked Sendable {
    let events: AsyncStream<WebSocketConnectionEvent>
    private let continuation: AsyncStream<WebSocketConnectionEvent>.Continuation
    private(set) var sentTexts: [String] = []
    private(set) var closeCalls: [Int] = []

    init() {
        var box: AsyncStream<WebSocketConnectionEvent>.Continuation?
        events = AsyncStream { box = $0 }
        continuation = box!
    }

    func push(_ event: WebSocketConnectionEvent) {
        continuation.yield(event)
    }

    func send(text: String) async throws {
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

/// Polls `model.snapshot` for `predicate` — the model mirrors its session's
/// `changes` stream on a background `Task`, so a test must wait for that
/// hop the same way `RulesModelTests` waits for `RulesModel`'s send/rollback
/// tasks: short sleeps, bounded by a max wait.
@MainActor
private func waitUntil(_ predicate: () -> Bool, timeoutMs: Int = 500) async {
    var waited = 0
    while !predicate(), waited < timeoutMs {
        try? await Task.sleep(for: .milliseconds(10))
        waited += 10
    }
}

@MainActor
@Suite("WebSocketConnectionModel")
struct WebSocketConnectionModelTests {
    @Test func unparsableURLSurfacesAnErrorInsteadOfConnecting() async {
        let model = WebSocketConnectionModel(transport: FakeWebSocketTransport(connection: FakeWebSocketConnection()))

        model.connect(urlString: "")

        #expect(model.connectError != nil)
        #expect(model.state == .idle)
    }

    @Test func connectReachesOpenOnceTheTransportOpens() async {
        let fake = FakeWebSocketConnection()
        let model = WebSocketConnectionModel(transport: FakeWebSocketTransport(connection: fake))

        model.connect(urlString: "wss://example.com/socket")
        await waitUntil { model.state == .connecting }
        fake.push(.opened(wsProtocol: "chat"))
        await waitUntil { model.state.isOpen }

        #expect(model.state == .open(wsProtocol: "chat"))
    }

    @Test func sendWhileOpenReachesTheConnectionAndAppearsInFrames() async {
        let fake = FakeWebSocketConnection()
        let model = WebSocketConnectionModel(transport: FakeWebSocketTransport(connection: fake))
        model.connect(urlString: "wss://example.com/socket")
        fake.push(.opened(wsProtocol: nil))
        await waitUntil { model.state.isOpen }

        model.send(text: "ping")
        await waitUntil { model.snapshot.frames.contains { $0.payload == .text("ping") } }

        #expect(fake.sentTexts == ["ping"])
    }

    /// Without disconnecting the previous session, its socket stays open on
    /// the server even though the UI has already moved on to a new one.
    @Test func connectingAgainDisconnectsThePreviousSession() async {
        let fake = FakeWebSocketConnection()
        let model = WebSocketConnectionModel(transport: FakeWebSocketTransport(connection: fake))
        model.connect(urlString: "wss://example.com/first")
        fake.push(.opened(wsProtocol: nil))
        await waitUntil { model.state.isOpen }

        model.connect(urlString: "wss://example.com/second")
        await waitUntil { !fake.closeCalls.isEmpty }

        #expect(fake.closeCalls == [1000], "reconnecting must close the previous still-open session, not leak it")
    }

    /// Same leak on the invalid-URL early-return path: the UI resets to
    /// "not connected" while the previous socket was left untouched.
    @Test func reconnectingWithAnInvalidURLStillDisconnectsThePreviousSession() async {
        let fake = FakeWebSocketConnection()
        let model = WebSocketConnectionModel(transport: FakeWebSocketTransport(connection: fake))
        model.connect(urlString: "wss://example.com/first")
        fake.push(.opened(wsProtocol: nil))
        await waitUntil { model.state.isOpen }

        model.connect(urlString: "")
        await waitUntil { !fake.closeCalls.isEmpty }

        #expect(fake.closeCalls == [1000], "an invalid new URL must still close the previous session, not leak it")
        #expect(model.connectError != nil)
        #expect(model.snapshot == .empty)
    }

    @Test func disconnectSurfacesClosed() async {
        let fake = FakeWebSocketConnection()
        let model = WebSocketConnectionModel(transport: FakeWebSocketTransport(connection: fake))
        model.connect(urlString: "wss://example.com/socket")
        fake.push(.opened(wsProtocol: nil))
        await waitUntil { model.state.isOpen }

        model.disconnect()
        await waitUntil { model.state.isTerminal }

        #expect(model.state == .closed(code: 1000))
    }
}
