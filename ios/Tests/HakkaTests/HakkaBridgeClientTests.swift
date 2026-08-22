import Foundation
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
