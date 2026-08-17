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
}
