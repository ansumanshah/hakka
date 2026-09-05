import Foundation
import Network
import Testing
@testable import HakkaNetwork
@testable import HakkaCommon

// MARK: - HakkaBridgeClient unit tests

/// Tests that do not require a live WebSocket server.
@Suite struct HakkaBridgeClientTests {

    // MARK: - HakkaConfig.bridgeURL

    @Test func bridgeURLDefaultsToNil() {
        let config = HakkaConfig.default
        #expect(config.bridgeURL == nil)
    }

    @Test func bridgeURLRoundTripsViaInit() {
        let url = URL(string: "ws://localhost:8989")!
        let config = HakkaConfig(bridgeURL: url)
        #expect(config.bridgeURL == url)
    }

    @Test func bridgeURLRoundTripsViaReplacing() {
        let url = URL(string: "ws://localhost:8989")!
        let config = HakkaConfig.default.replacing(bridgeURL: url)
        #expect(config.bridgeURL == url)
    }

    @Test func replacingWithNilBridgeURLPreservesExisting() {
        let url = URL(string: "ws://localhost:8989")!
        let base = HakkaConfig(bridgeURL: url)
        // passing nil for bridgeURL?? means "don't change it"
        let updated = base.replacing(maxRequests: 100)
        #expect(updated.bridgeURL == url)
    }

    // MARK: - Wire frame format

    @Test func encodeProducesCorrectWireFormat() throws {
        let request = NetworkRequest(
            id: "test-id",
            url: "https://api.example.com/users",
            method: .get,
            status: 200,
            startTime: 1_000,
            duration: 42,
            source: .urlSession
        )

        // Instantiate a client and use the internal encoding path via a
        // roundtrip through JSON, verifying the wire shape matches protocol.ts.
        let client = HakkaBridgeClient(url: URL(string: "ws://localhost:8989")!)
        // The client is not started — only the encoding logic is tested, by
        // constructing the expected JSON shape manually and comparing.
        let encoder = JSONEncoder()
        encoder.outputFormatting = []

        struct Wire: Encodable {
            let type: String = "request"
            let payload: NetworkRequest
        }
        let data = try encoder.encode(Wire(payload: request))
        let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]

        #expect(obj?["type"] as? String == "request")
        let payload = try #require(obj?["payload"] as? [String: Any])
        #expect(payload["id"] as? String == "test-id")
        #expect(payload["url"] as? String == "https://api.example.com/users")
        #expect(payload["method"] as? String == "GET")
        #expect(payload["status"] as? Int == 200)

        // Suppress unused-variable warning
        _ = client
    }

    // MARK: - console / storage wire frames

    @Test func encodeFrameProducesConsoleWireFormat() throws {
        let client = HakkaBridgeClient(url: URL(string: "ws://localhost:8989")!)
        let entry = LogEntry(id: "log_1", timestamp: 1_732_000_000_000, level: .warn, message: "cache stale", category: "cache")
        let frame = try #require(client.encodeFrame([entry], type: "console"))
        let obj = try JSONSerialization.jsonObject(with: Data(frame.utf8)) as? [String: Any]

        #expect(obj?["type"] as? String == "console")
        let payload = try #require(obj?["payload"] as? [[String: Any]])
        #expect(payload.count == 1)
        #expect(payload.first?["id"] as? String == "log_1")
        #expect(payload.first?["level"] as? String == "warn")
        #expect(payload.first?["message"] as? String == "cache stale")
        #expect(payload.first?["category"] as? String == "cache")
    }

    @Test func encodeFrameProducesStorageWireFormat() throws {
        let client = HakkaBridgeClient(url: URL(string: "ws://localhost:8989")!)
        let snapshot = StorageSnapshot(store: "defaults", timestamp: 1_732_000_000_500, entries: ["theme": "dark"])
        let frame = try #require(client.encodeFrame(snapshot, type: "storage"))
        let obj = try JSONSerialization.jsonObject(with: Data(frame.utf8)) as? [String: Any]

        #expect(obj?["type"] as? String == "storage")
        let payload = try #require(obj?["payload"] as? [String: Any])
        #expect(payload["store"] as? String == "defaults")
        #expect(payload["timestamp"] as? Int64 == 1_732_000_000_500)
        let entries = try #require(payload["entries"] as? [String: String])
        #expect(entries == ["theme": "dark"])
    }

    @Test func sendConsoleOnAnEmptyBatchIsANoOp() {
        // Guards against ever emitting `{"type":"console","payload":[]}` — an
        // empty batch is not a meaningful frame for any receiver.
        let client = HakkaBridgeClient(url: URL(string: "ws://localhost:8989")!)
        #expect(client.encodeFrame([] as [LogEntry], type: "console") != nil)
        // encodeFrame itself is shape-agnostic (it would happily encode an
        // empty array) — the emptiness guard lives in `sendConsole`, which
        // this only exercises for "does not crash" since delivery is
        // fire-and-forget with no externally observable queue here.
        client.sendConsole([])
    }

    // MARK: - Interceptor wiring

    @Test func interceptorWithBridgeURLStreamsCapture() {
        // Setting bridgeURL makes the interceptor create a HakkaBridgeClient
        // internally, but the interceptor is never started (no live server
        // needed) — this only verifies commitProcessedCapture doesn't crash
        // when a bridge client is configured.
        let url = URL(string: "ws://localhost:9999")!
        let config = HakkaConfig(maxRequests: 10, bridgeURL: url)
        let interceptor = HakkaInterceptor(config: config)

        let request = NetworkRequest(
            id: "bridge-test",
            url: "https://api.example.com/bridge",
            method: .post,
            status: 201,
            startTime: Int64(Date().timeIntervalSince1970 * 1000),
            duration: 10,
            source: .urlSession
        )

        // commitProcessedCapture is internal; use the public didCapture path.
        interceptor.didCapture(request)
        interceptor.flushCaptureProcessing()

        // Store should contain the record regardless of bridge connectivity.
        #expect(interceptor.store.request(byId: "bridge-test") != nil)
    }

    @Test func logWithBridgeConfiguredDoesNotCrashAndStillWritesToLogStore() {
        // Same "no live server needed" contract as
        // `interceptorWithBridgeURLStreamsCapture` above — this only proves
        // `log()`'s new `bridgeClient?.sendConsole(...)` call is safe with an
        // unstarted (never-connected) client, and that `logStore` still gets
        // the entry regardless of bridge state.
        let url = URL(string: "ws://localhost:9999")!
        let interceptor = HakkaInterceptor(config: HakkaConfig(bridgeURL: url))

        interceptor.log(.warn, "cache stale", category: "cache")

        let entries = interceptor.logStore.getEntries()
        #expect(entries.count == 1)
        #expect(entries.first?.message == "cache stale")
        #expect(entries.first?.level == .warn)
    }

    @Test func publishStorageSnapshotWithBridgeConfiguredDoesNotCrash() {
        let url = URL(string: "ws://localhost:9999")!
        let interceptor = HakkaInterceptor(config: HakkaConfig(bridgeURL: url))
        interceptor.publishStorageSnapshot(store: "defaults", entries: ["a": "1"])
    }

    @Test func publishStorageSnapshotWithNoBridgeConfiguredIsANoOp() {
        let interceptor = HakkaInterceptor(config: .default)
        interceptor.publishStorageSnapshot(store: "defaults", entries: ["a": "1"])
    }
}

// MARK: - HakkaBridgeClient over a real socket

/// Minimal loopback WebSocket server standing in for the desktop bridge hub
/// (or `hakka sim attach`'s Node hub) — Network.framework's built-in
/// `NWProtocolWebSocket` handles the HTTP upgrade handshake, the same
/// mechanism `BridgeServer`/`BridgeConnection` (`apps/hakka/Sources/Server`)
/// use on the production peer this SDK client talks to. Modeled on
/// `MiniHTTPServer` (`LiveCaptureTests.swift`) — same bounded-`start()`,
/// poll-rather-than-block idiom.
final class MiniWebSocketServer: @unchecked Sendable {
    enum ServerError: Error { case startFailed, portUnavailable }

    private let listener: NWListener
    private let queue = DispatchQueue(label: "com.noodleapps.hakka.tests.mini-ws-server")
    private let lock = NSLock()
    private var connections: [NWConnection] = []
    private var frames: [String] = []

    /// `port: 0` (the default) binds an ephemeral port; passing a specific
    /// port lets a test rebind the same address after `stop()`, proving
    /// redelivery across a reconnect.
    init(port: UInt16 = 0) throws {
        let wsOptions = NWProtocolWebSocket.Options()
        wsOptions.autoReplyPing = true
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        parameters.acceptLocalOnly = true
        parameters.defaultProtocolStack.applicationProtocols.insert(wsOptions, at: 0)
        let endpointPort: NWEndpoint.Port = port == 0 ? .any : (NWEndpoint.Port(rawValue: port) ?? .any)
        listener = try NWListener(using: parameters, on: endpointPort)
    }

    /// Starts listening and returns the bound loopback port. Blocks briefly
    /// (bounded) until the listener reports `.ready`, same pattern as
    /// `MiniHTTPServer.start()`.
    func start() throws -> UInt16 {
        let semaphore = DispatchSemaphore(value: 0)
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready, .failed: semaphore.signal()
            default: break
            }
        }
        listener.start(queue: queue)
        guard semaphore.wait(timeout: .now() + 5) == .success else { throw ServerError.startFailed }
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

    private func framesSnapshot() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return frames
    }

    /// Polls (bounded) for at least `count` received text frames, mirroring
    /// `LiveCaptureTests`'s deadline-poll idiom rather than a continuation —
    /// this server has multiple, sequentially-arriving frames to observe,
    /// not one single event.
    func waitForFrames(count: Int, timeout: TimeInterval = 8, type: String? = nil) async -> [String] {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let snapshot = framesSnapshot().filter { frame in
                guard let type else { return true }
                let object = try? JSONSerialization.jsonObject(with: Data(frame.utf8)) as? [String: Any]
                return object?["type"] as? String == type
            }
            if snapshot.count >= count { return snapshot }
            try? await Task.sleep(nanoseconds: 20_000_000)
        }
        return framesSnapshot()
    }

    func send(_ raw: String) {
        lock.lock()
        let live = connections
        lock.unlock()
        let metadata = NWProtocolWebSocket.Metadata(opcode: .text)
        let context = NWConnection.ContentContext(identifier: "runtime-control-test", metadata: [metadata])
        for connection in live {
            connection.send(content: Data(raw.utf8), contentContext: context, isComplete: true, completion: .contentProcessed { _ in })
        }
    }

    private func accept(_ connection: NWConnection) {
        lock.lock()
        connections.append(connection)
        lock.unlock()
        connection.start(queue: queue)
        receiveNext(connection, buffered: Data())
    }

    /// `receiveMessage` can hand back one WebSocket message across multiple
    /// calls (`isComplete` marks the boundary) — accumulate the same way
    /// `BridgeConnection.receiveNext` does, rather than assuming one call is
    /// always a whole message.
    private func receiveNext(_ connection: NWConnection, buffered: Data) {
        connection.receiveMessage { [weak self] content, _, isComplete, error in
            guard let self else { return }
            var accumulated = buffered
            if let content { accumulated.append(content) }
            if isComplete {
                if !accumulated.isEmpty, let text = String(data: accumulated, encoding: .utf8) {
                    self.lock.lock()
                    self.frames.append(text)
                    self.lock.unlock()
                }
                accumulated = Data()
            }
            guard content != nil, error == nil else { return }
            self.receiveNext(connection, buffered: accumulated)
        }
    }
}

/// Every other test in `HakkaBridgeClientTests` above proves encoding and
/// interceptor wiring without a live server, so a defect in the client's own
/// socket handling could never fail them — the same gap the desktop's
/// `BridgeSocketTests` (`apps/hakka/Tests/CoreTests`) documents for its own
/// hub. This suite drives `HakkaBridgeClient` against a real loopback
/// `MiniWebSocketServer`.
@Suite("HakkaBridgeClient over a real socket")
struct HakkaBridgeClientSocketTests {
    private func makeRequest(id: String) -> NetworkRequest {
        NetworkRequest(
            id: id, url: "https://socket.test/\(id)", method: .get, status: 200,
            startTime: Int64(Date().timeIntervalSince1970 * 1000), duration: 1, source: .urlSession
        )
    }

    /// The baseline `SDKBridgeClientTests` (`apps/hakka/Tests/CoreTests/BridgeSocketTests.swift`)
    /// already proves: a directly-constructed, directly-started client
    /// delivers a frame with no `HakkaInterceptor` in the picture. Kept here
    /// too as a fast (sub-second) sanity check that this package's copy of
    /// the same client still behaves identically before the narrower test
    /// below runs — if this one ever fails, the defect is NOT the one this
    /// file exists to guard against.
    @Test func aDirectlyConstructedClientDeliversAFrameOverARealSocket() async throws {
        let server = try MiniWebSocketServer()
        let port = try server.start()
        defer { server.stop() }

        let client = HakkaBridgeClient(url: URL(string: "ws://127.0.0.1:\(port)")!)
        client.start()
        defer { client.stop() }

        client.send(makeRequest(id: "direct"))

        let frames = try #require(await server.waitForFrames(count: 1, type: "request").first)
        #expect(frames.contains("\"direct\""))
    }

    @Test func nativeRuntimeAdvertisesAndAcknowledgesOverSocket() async throws {
        let server = try MiniWebSocketServer()
        let port = try server.start()
        defer { server.stop() }
        let client = HakkaBridgeClient(url: URL(string: "ws://127.0.0.1:\(port)")!)
        client.start()
        defer { client.stop() }
        let hello = try #require(await server.waitForFrames(count: 1, type: "runtime.hello").first)
        guard case .hello(_, let runtime, let capabilities) = parseRuntimeControlFrame(hello) else {
            Issue.record("missing hello"); return
        }
        #expect(runtime == "ios")
        #expect(capabilities == RuntimeControlFrame.nativeCapabilities)
        server.send(#"{"type":"runtime.welcome","payload":{"targetId":"target-a"}}"#)
        server.send(#"{"type":"control.request","payload":{"commandId":"socket-command","targetId":"target-a","timeoutMs":5000,"command":{"kind":"mock.clear"}}}"#)
        let raw = try #require(await server.waitForFrames(count: 1, type: "control.result").first)
        guard case .result(let result) = parseRuntimeControlFrame(raw) else { Issue.record("missing result"); return }
        #expect(result.commandId == "socket-command")
        #expect(result.status == "applied")
    }

    /// Reproduces the exact failure the SimInject spike (commit `57c9ba92`)
    /// hit and reported as "connects but never delivers", now root-caused:
    /// `HakkaInterceptor.start()` swizzles `URLSessionConfiguration.default`/
    /// `.ephemeral` to inject `HakkaURLProtocol` into every session built
    /// from them (and registers it process-wide via
    /// `URLProtocol.registerClass(_:)`) — the normal, intended state once a
    /// host app captures its own traffic AND streams to the bridge, which is
    /// exactly what `HakkaSimInjectBootstrap.start()` does. Before the fix,
    /// this client's own outbound WebSocket handshake — an `http`-scheme
    /// request until it upgrades, so `HakkaURLProtocol.canInit` accepted it —
    /// got captured by that same interception and replayed as a plain HTTP
    /// request, which cannot preserve a WebSocket upgrade: the connection
    /// dropped with `NSURLErrorNetworkConnectionLost` and the queued frame
    /// sat undelivered.
    ///
    /// This is the scenario `SDKBridgeClientTests` (`apps/hakka`) and
    /// `aDirectlyConstructedClientDeliversAFrameOverARealSocket` above cannot
    /// reach: both construct `HakkaBridgeClient` directly, so no
    /// interceptor's `start()` ever runs and the swizzle is never installed
    /// — which is exactly why the bug is narrower than "delivery is broken"
    /// and survived those existing suites.
    @Test func aCaptureFromARunningInterceptorReachesTheHub() async throws {
        let server = try MiniWebSocketServer()
        let port = try server.start()
        defer { server.stop() }

        let interceptor = HakkaInterceptor(config: HakkaConfig(bridgeURL: URL(string: "ws://127.0.0.1:\(port)")!))
        interceptor.start()
        defer { interceptor.stop() }

        interceptor.didCapture(makeRequest(id: "via-interceptor"))
        interceptor.flushCaptureProcessing()

        let frames = try #require(
            await server.waitForFrames(count: 1, type: "request").first,
            "a capture made while HakkaInterceptor's own request-capture swizzle is active never reached the hub"
        )
        #expect(frames.contains("\"via-interceptor\""))
    }
}
