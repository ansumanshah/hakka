import Foundation
import Testing
@testable import HakkaNetwork
@testable import HakkaCommon

// MARK: - WsMessage model tests

@Suite("WsMessage")
struct WsMessageTests {

    // MARK: - Basic construction

    @Test func textFrameDefaultsNonBinary() {
        let msg = WsMessage(
            timestamp: 1000,
            direction: .received,
            data: .text("hello"),
            size: 5
        )
        #expect(msg.direction == .received)
        #expect(msg.binary == false)
        #expect(msg.size == 5)
        if case .text(let s) = msg.data { #expect(s == "hello") } else { Issue.record("Expected text payload") }
    }

    @Test func binaryFrameByteCount() {
        let msg = WsMessage(
            timestamp: 2000,
            direction: .sent,
            data: .byteCount(70_000),
            size: 70_000,
            binary: true
        )
        #expect(msg.binary == true)
        #expect(msg.direction == .sent)
        if case .byteCount(let n) = msg.data { #expect(n == 70_000) } else { Issue.record("Expected byteCount payload") }
    }

    // MARK: - Codable round-trip

    @Test func textCodableRoundTrip() throws {
        let msg = WsMessage(timestamp: 1234, direction: .sent, data: .text("{\"type\":\"ping\"}"), size: 15)
        let data = try JSONEncoder().encode(msg)
        let decoded = try JSONDecoder().decode(WsMessage.self, from: data)
        #expect(decoded == msg)
        #expect(decoded.binary == false)
        if case .text(let s) = decoded.data { #expect(s == "{\"type\":\"ping\"}") }
        else { Issue.record("Expected text after round-trip") }
    }

    @Test func byteCountCodableRoundTrip() throws {
        let msg = WsMessage(timestamp: 5678, direction: .received, data: .byteCount(99_999), size: 99_999, binary: true)
        let data = try JSONEncoder().encode(msg)
        let decoded = try JSONDecoder().decode(WsMessage.self, from: data)
        #expect(decoded == msg)
        #expect(decoded.binary == true)
        if case .byteCount(let n) = decoded.data { #expect(n == 99_999) }
        else { Issue.record("Expected byteCount after round-trip") }
    }

    @Test func base64BinaryCodableRoundTrip() throws {
        let b64 = "aGVsbG8="
        let msg = WsMessage(timestamp: 3000, direction: .received, data: .text(b64), size: 5, binary: true)
        let data = try JSONEncoder().encode(msg)
        let decoded = try JSONDecoder().decode(WsMessage.self, from: data)
        #expect(decoded == msg)
        #expect(decoded.binary == true)
        if case .text(let s) = decoded.data { #expect(s == b64) }
        else { Issue.record("Expected base64 string after round-trip") }
    }

    // MARK: - Direction encoding

    @Test func directionWireValues() throws {
        let sent = WsMessage(timestamp: 1, direction: .sent, data: .text("x"), size: 1)
        let recv = WsMessage(timestamp: 2, direction: .received, data: .text("y"), size: 1)

        let sentData = try JSONEncoder().encode(sent)
        let sentJSON = try #require(try JSONSerialization.jsonObject(with: sentData) as? [String: Any])
        #expect(sentJSON["direction"] as? String == "sent")

        let recvData = try JSONEncoder().encode(recv)
        let recvJSON = try #require(try JSONSerialization.jsonObject(with: recvData) as? [String: Any])
        #expect(recvJSON["direction"] as? String == "received")
    }

    // MARK: - Payload JSON shape

    @Test func textPayloadEncodesAsString() throws {
        let msg = WsMessage(timestamp: 1, direction: .sent, data: .text("hello"), size: 5)
        let data = try JSONEncoder().encode(msg)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["data"] as? String == "hello")
    }

    @Test func byteCountEncodesAsNumber() throws {
        let msg = WsMessage(timestamp: 1, direction: .sent, data: .byteCount(42), size: 42, binary: true)
        let data = try JSONEncoder().encode(msg)
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["data"] as? Int == 42)
    }
}

// MARK: - NetworkRequest messages + wsProtocol fields

@Suite("NetworkRequestWsFields")
struct NetworkRequestWsFieldsTests {

    @Test func messagesDefaultNil() {
        let req = NetworkRequest(url: "wss://example.com", method: .get, startTime: 1000, source: .nativeWebSocket)
        #expect(req.messages == nil)
        #expect(req.wsProtocol == nil)
    }

    @Test func messagesAndProtocolStored() {
        let frames: [WsMessage] = [
            WsMessage(timestamp: 1001, direction: .sent, data: .text("ping"), size: 4),
            WsMessage(timestamp: 1002, direction: .received, data: .text("pong"), size: 4),
        ]
        let req = NetworkRequest(
            url: "wss://example.com",
            method: .get,
            startTime: 1000,
            source: .nativeWebSocket,
            messages: frames,
            wsProtocol: "mqtt"
        )
        #expect(req.messages?.count == 2)
        #expect(req.wsProtocol == "mqtt")
    }

    @Test func messagesAndProtocolCodable() throws {
        let frames: [WsMessage] = [
            WsMessage(timestamp: 100, direction: .sent, data: .text("{\"op\":1}"), size: 8),
            WsMessage(timestamp: 200, direction: .received, data: .byteCount(65_536), size: 65_536, binary: true),
        ]
        let req = NetworkRequest(
            url: "wss://example.com/chat",
            method: .get,
            status: 101,
            startTime: 50,
            duration: 500,
            source: .nativeWebSocket,
            wsMessageCount: 2,
            wsCloseCode: 1000,
            messages: frames,
            wsProtocol: "chat"
        )
        let data = try JSONEncoder().encode(req)
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(decoded == req)
        #expect(decoded.messages?.count == 2)
        #expect(decoded.wsProtocol == "chat")
        #expect(decoded.messages?[1].binary == true)
        if case .byteCount(let n) = decoded.messages?[1].data { #expect(n == 65_536) }
        else { Issue.record("Expected byteCount in second frame") }
    }

    @Test func emptyMessagesArrayRoundTrip() throws {
        let req = NetworkRequest(
            url: "wss://example.com",
            method: .get,
            startTime: 1000,
            source: .nativeWebSocket,
            messages: [],
            wsProtocol: nil
        )
        let data = try JSONEncoder().encode(req)
        let decoded = try JSONDecoder().decode(NetworkRequest.self, from: data)
        #expect(decoded.messages?.isEmpty == true)
    }
}

// MARK: - HakkaWSTracker unit tests

// HakkaWSTracker uses URLSessionWebSocketTask which requires iOS 13+.
// The package min-deployment is iOS 16, so availability is always satisfied.
@Suite("HakkaWSTracker")
struct HakkaWSTrackerTests {

    // Helper: flush tracker into interceptor and drain the async queue synchronously.
    private func flushAndSync(tracker: HakkaWSTracker, interceptor: HakkaInterceptor) {
        tracker.flush(interceptor: interceptor)
        interceptor.flushCaptureProcessing()
    }

    @Test func textFrameCapture() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t1", url: "wss://x.com", startTime: 1000)
        tracker.frameReceived(message: .string("hello world"), negotiatedProtocol: nil)
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        let req = interceptor.store.requests.first
        #expect(req != nil)
        #expect(req?.messages?.count == 1)
        #expect(req?.messages?.first?.direction == .received)
        #expect(req?.messages?.first?.binary == false)
        if case .text(let s) = req?.messages?.first?.data { #expect(s == "hello world") }
        else { Issue.record("Expected text payload") }
    }

    @Test func binaryFrameWithinCapStoresBase64() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t2", url: "wss://x.com", startTime: 1000)
        let bytes = Data(repeating: 0xAB, count: 100)
        tracker.frameReceived(message: .data(bytes), negotiatedProtocol: nil)
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        let frame = interceptor.store.requests.first?.messages?.first
        #expect(frame?.binary == true)
        #expect(frame?.size == 100)
        // data should be base64 string (within 32KB cap)
        if case .text(let b64) = frame?.data {
            let decoded = Data(base64Encoded: b64)
            #expect(decoded?.count == 100)
        } else {
            Issue.record("Expected base64 text payload for small binary")
        }
    }

    @Test func binaryFrameOverCapStoresByteCount() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t3", url: "wss://x.com", startTime: 1000)
        let bytes = Data(repeating: 0xFF, count: 33_000)  // > 32KB
        tracker.frameReceived(message: .data(bytes), negotiatedProtocol: nil)
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        let frame = interceptor.store.requests.first?.messages?.first
        #expect(frame?.binary == true)
        #expect(frame?.size == 33_000)
        if case .byteCount(let n) = frame?.data { #expect(n == 33_000) }
        else { Issue.record("Expected byteCount for oversized binary") }
    }

    @Test func negotiatedProtocolRecorded() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t4", url: "wss://x.com", startTime: 1000)
        tracker.frameReceived(message: .string("data"), negotiatedProtocol: "mqtt")
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        #expect(interceptor.store.requests.first?.wsProtocol == "mqtt")
    }

    @Test func multipleFramesOrdered() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t5", url: "wss://x.com", startTime: 1000)
        tracker.frameReceived(message: .string("a"), negotiatedProtocol: nil)
        tracker.frameSent(message: .string("b"))
        tracker.frameReceived(message: .string("c"), negotiatedProtocol: nil)
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        let messages = interceptor.store.requests.first?.messages
        #expect(messages?.count == 3)
        #expect(messages?[0].direction == .received)
        #expect(messages?[1].direction == .sent)
        #expect(messages?[2].direction == .received)
    }

    @Test func flushOnlyOnce() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t6", url: "wss://x.com", startTime: 1000)
        tracker.frameReceived(message: .string("x"), negotiatedProtocol: nil)
        tracker.emitClose(closeCode: 1000, reason: nil)
        tracker.flush(interceptor: interceptor)
        tracker.flush(interceptor: interceptor)  // second flush is a no-op
        interceptor.flushCaptureProcessing()
        #expect(interceptor.store.requests.count == 1)
    }

    @Test func noFramesEmitsNilMessages() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t7", url: "wss://x.com", startTime: 1000)
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        #expect(interceptor.store.requests.first?.messages == nil)
    }

    @Test func messageCountMatchesFrameCount() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t8", url: "wss://x.com", startTime: 1000)
        for _ in 0..<5 {
            tracker.frameReceived(message: .string("msg"), negotiatedProtocol: nil)
        }
        tracker.emitClose(closeCode: 1001, reason: "going away")
        flushAndSync(tracker: tracker, interceptor: interceptor)
        #expect(interceptor.store.requests.first?.wsMessageCount == 5)
        #expect(interceptor.store.requests.first?.messages?.count == 5)
    }

    @Test func firstNonEmptyNegotiatedProtocolWins() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t9", url: "wss://x.com", startTime: 1000)
        tracker.frameReceived(message: .string("first"), negotiatedProtocol: "chat.v1")
        tracker.frameReceived(message: .string("second"), negotiatedProtocol: "chat.v2")
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        #expect(interceptor.store.requests.first?.wsProtocol == "chat.v1")
    }

    @Test func firstCloseCodeWins() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t10", url: "wss://x.com", startTime: 1000)
        tracker.emitClose(closeCode: 1000, reason: nil)
        tracker.emitClose(closeCode: 1006, reason: nil)  // second call must not override
        flushAndSync(tracker: tracker, interceptor: interceptor)
        #expect(interceptor.store.requests.first?.wsCloseCode == 1000)
    }

    @Test func binaryFrameAtExactCapStoresBase64() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t11", url: "wss://x.com", startTime: 1000)
        let bytes = Data(repeating: 0xCD, count: wsBinaryCap)  // exactly at the cap, not over it
        tracker.frameReceived(message: .data(bytes), negotiatedProtocol: nil)
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)
        let frame = interceptor.store.requests.first?.messages?.first
        #expect(frame?.binary == true)
        if case .text(let b64) = frame?.data {
            #expect(Data(base64Encoded: b64)?.count == wsBinaryCap)
        } else {
            Issue.record("Expected base64 text payload at the exact cap boundary")
        }
    }

    // MARK: - Frame cap (drop-oldest, no eviction ceiling before this)

    /// Mirrors Android's `HakkaWebSocketWrapperTest`'s
    /// "frames are capped at MAX_FRAMES, dropping oldest first" — a
    /// long-lived, high-traffic connection (chat, a live feed, or Hakka's own
    /// bridge connection) must not retain every frame's payload in memory for
    /// the life of the connection.
    @Test func framesAreCappedAtMaxFramesDroppingOldestFirst() {
        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t12", url: "wss://x.com", startTime: 1000)
        let overflow = 5
        for i in 0..<(wsMaxFrames + overflow) {
            tracker.frameReceived(message: .string("frame-\(i)"), negotiatedProtocol: nil)
        }
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)

        let request = interceptor.store.requests.first
        let frames = request?.messages
        #expect(
            frames?.count == wsMaxFrames,
            "Frame count should be capped at wsMaxFrames instead of growing without bound"
        )
        if case .text(let first) = frames?.first?.data {
            #expect(first == "frame-\(overflow)", "Oldest frames should have been evicted")
        } else {
            Issue.record("Expected text payload")
        }
        if case .text(let last) = frames?.last?.data {
            #expect(last == "frame-\(wsMaxFrames + overflow - 1)", "Newest frame should be retained")
        } else {
            Issue.record("Expected text payload")
        }
        // `wsMessageCount` is incremented before eviction runs, so it keeps
        // reflecting the TRUE total even once `messages` is capped — this
        // mismatch is what makes a capped connection detectable instead of
        // silently looking like a short one.
        #expect(request?.wsMessageCount == wsMaxFrames + overflow)
    }

    /// The cap crossing must be visible (Console/`log stream` + the Logs
    /// inspector panel), not a silent drop — and logged exactly once per
    /// connection, not once per subsequently-dropped frame. Subscribes
    /// directly to `HakkaInterceptor.shared.logStore` (the sink
    /// `HakkaOSLogBridge` forwards to) and filters by a unique marker
    /// embedded in the tracker's URL so this stays safe to run alongside
    /// other tests touching the same process-wide singleton.
    @Test func exceedingCapLogsAVisibleWarningExactlyOnce() {
        let marker = "cap-warn-\(UUID().uuidString)"
        let box = CapturedMessagesBox()
        let subscription = HakkaInterceptor.shared.logStore.subscribe { entry in
            box.append(entry.message)
        }
        defer { subscription.unsubscribe() }

        let interceptor = HakkaInterceptor()
        let tracker = HakkaWSTracker(taskId: "t13", url: "wss://\(marker)", startTime: 1000)
        for _ in 0..<(wsMaxFrames + 3) {
            tracker.frameReceived(message: .string("x"), negotiatedProtocol: nil)
        }
        tracker.emitClose(closeCode: 1000, reason: nil)
        flushAndSync(tracker: tracker, interceptor: interceptor)

        let matches = box.snapshot().filter { $0.contains(marker) }
        #expect(
            matches.count == 1,
            "Exactly one warning should be logged the first time the cap is crossed, not once per dropped frame after"
        )
    }
}

/// Thread-safe accumulator for a `HakkaLogStore.subscribe` listener, which
/// runs in `@Sendable` closure context — plain captured `var`s aren't legal
/// there.
private final class CapturedMessagesBox: @unchecked Sendable {
    private let lock = NSLock()
    private var messages: [String] = []

    func append(_ message: String) {
        lock.lock()
        messages.append(message)
        lock.unlock()
    }

    func snapshot() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return messages
    }
}

// MARK: - HakkaWebSocketMonitor self-exclusion (marked bridge session only)

// `.serialized`: exercises the real `URLSession.webSocketTask(with:)` swizzle
// and `HakkaWebSocketMonitor.globalInterceptor` — process-wide statics that
// must not race against another suite's `interceptor.start()`/`stop()`, the
// same reasoning `URLProtocolEdgeTests` documents for the HTTP-side swizzle.
@Suite("HakkaWebSocketMonitor self-exclusion", .serialized)
struct HakkaWebSocketMonitorSelfExclusionTests {

    /// Reproduces exactly what `HakkaBridgeClient.openConnection()` builds:
    /// a session marked via `HakkaInternalSocketMarker.mark(_:)` before any
    /// task exists on it. Before the original fix, `wrapIfNeeded` had no
    /// equivalent check at all, so Hakka's own outbound WebSocket connection
    /// to the desktop bridge got wrapped and tracked like any app traffic.
    @Test func markedSessionIsNeverWrapped() {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        interceptor.enableNativeWebSocket()
        defer { interceptor.stop() }

        let session = URLSession(configuration: .default)
        HakkaInternalSocketMarker.mark(session)
        let task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:9999")!)
        defer { task.cancel(with: .goingAway, reason: nil) }

        #expect(debugHasWSTracker(task) == false)
    }

    /// Regression for the false-positive the original `protocolClasses ==
    /// []` heuristic had: a host-app session that independently opts out of
    /// custom protocol handling — for reasons that have nothing to do with
    /// Hakka — used to be indistinguishable from the bridge's own session,
    /// so its native WebSocket traffic silently vanished from the inspector.
    /// An *unmarked* session built exactly like `HakkaBridgeClient`'s (same
    /// `protocolClasses = []`) must now be captured normally, since object
    /// identity — not that coincidental config value — is what excludes a
    /// session.
    @Test func unmarkedSessionThatOptedOutOfProtocolHandlingIsStillWrapped() {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        interceptor.enableNativeWebSocket()
        defer { interceptor.stop() }

        let config = URLSessionConfiguration.default
        config.protocolClasses = []
        let session = URLSession(configuration: config)
        let task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:9998")!)
        defer { task.cancel(with: .goingAway, reason: nil) }

        #expect(debugHasWSTracker(task) == true)
    }

    /// A session with `protocolClasses == nil` (the ordinary case for an app
    /// that never touched `protocolClasses` itself) is untouched by the
    /// marker check and still gets wrapped normally — proves the exclusion
    /// stays scoped to sessions Hakka itself marks, not a regression on
    /// ordinary WebSocket capture.
    @Test func ordinarySessionIsStillWrapped() {
        let interceptor = HakkaInterceptor()
        interceptor.start()
        interceptor.enableNativeWebSocket()
        defer { interceptor.stop() }

        let session = URLSession(configuration: .default)
        let task = session.webSocketTask(with: URL(string: "wss://example.com/socket")!)
        defer { task.cancel(with: .goingAway, reason: nil) }

        #expect(debugHasWSTracker(task) == true)
    }

    /// A `HakkaBridgeClient` started through a real running `HakkaInterceptor`
    /// (not a hand-built stand-in) builds its session exactly the way
    /// `openConnection()` does — confirms the two unit tests above generalize
    /// to the actual production code path, over a real loopback socket, not
    /// just a manually reconstructed session. This does not by itself prove
    /// exclusion (the tracker attached to the bridge's own task isn't
    /// reachable from a test — `HakkaBridgeClient.task` is private, and
    /// `HakkaWSTracker.flush()` only fires on close, which a still-open
    /// bridge connection never reaches); `markedSessionIsNeverWrapped`
    /// above is what actually catches the regression, deterministically.
    @Test func aRunningBridgeConnectionDeliversCapturesNormally() async throws {
        let server = try MiniWebSocketServer()
        let port = try server.start()
        defer { server.stop() }

        let interceptor = HakkaInterceptor(
            config: HakkaConfig(captureNativeWebSocket: true, bridgeURL: URL(string: "ws://127.0.0.1:\(port)")!)
        )
        interceptor.start()
        defer { interceptor.stop() }

        interceptor.didCapture(
            NetworkRequest(
                id: "self-capture-0", url: "https://api.example.com/0", method: .get,
                status: 200, startTime: Int64(Date().timeIntervalSince1970 * 1000), duration: 1,
                source: .urlSession
            )
        )
        interceptor.flushCaptureProcessing()

        let frames = await server.waitForFrames(count: 1, type: "request")
        #expect(frames.first?.contains("self-capture-0") == true)
    }
}
