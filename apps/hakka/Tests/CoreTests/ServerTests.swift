import Foundation
import Network
import Testing
import HakkaCommon
@testable import HakkaCore
@testable import HakkaServer

// MARK: - Fixtures

/// Minimal `NetworkRequest` JSON satisfying every non-optional field —
/// matches the shape `HakkaBridgeClient`/RN/Android clients actually send.
private func requestFrameJSON(id: String = "req-1") -> String {
    """
    {"type":"request","payload":{"id":"\(id)","url":"https://example.com/api",\
    "method":"GET","startTime":1732000000000,"requestHeaders":{},"responseHeaders":{},\
    "requestBodySize":0,"responseBodySize":0,"source":"native","redirectCount":0,"redirectUrls":[]}}
    """
}

private func spanFrameJSON() -> String {
    #"{"type":"span","payload":{"traceId":"t1","spanId":"s1","name":"GET /"}}"#
}

/// A `.span` payload that actually satisfies `FrameworkSpan`, unlike
/// `spanFrameJSON()` above (which deliberately uses the wrong field names to
/// prove a still-parseable-but-undecoded frame). Field values match
/// `fixtures/span/server-root-span.json`.
private func validSpanFrameJSON(id: String = "span-root-1") -> String {
    """
    {"type":"span","payload":{"id":"\(id)","traceId":"trace-1","parentId":null,\
    "name":"POST /checkout","startTime":1732000000050,"endTime":1732000000400,\
    "verbosity":"primary","runtime":"server"}}
    """
}

private func controlFrameJSON() -> String {
    #"{"type":"control","payload":{"kind":"mock.clear"}}"#
}

// MARK: - parseBridgeFrame

@Suite("parseBridgeFrame")
struct ParseBridgeFrameTests {
    @Test func validRequestDecodes() {
        let frame = parseBridgeFrame(requestFrameJSON())
        #expect(frame?.kind == .request)
        #expect(frame?.request?.id == "req-1")
        #expect(frame?.request?.method == .get)
    }

    @Test func validSpanParsesWithoutDecodingRequest() {
        let frame = parseBridgeFrame(spanFrameJSON())
        #expect(frame?.kind == .span)
        #expect(frame?.request == nil)
    }

    /// The other half of `validSpanParsesWithoutDecodingRequest`: a `.span`
    /// frame whose payload DOES satisfy `FrameworkSpan` must decode it, the
    /// same way a well-formed `.request` payload decodes into
    /// `NetworkRequest`.
    @Test func wellFormedSpanFrameDecodesIntoFrameworkSpan() {
        let frame = parseBridgeFrame(validSpanFrameJSON())
        #expect(frame?.kind == .span)
        #expect(frame?.span?.id == "span-root-1")
        #expect(frame?.span?.traceId == "trace-1")
        #expect(frame?.span?.parentId == nil)
        #expect(frame?.span?.runtime == .server)
    }

    /// Mirrors `requestPayloadMissingRequiredFieldStillParsesButDoesNotDecode`
    /// for spans: the hub must never be stricter than the TS one it mirrors.
    @Test func spanPayloadMissingRequiredFieldStillParsesButDoesNotDecode() {
        let frame = parseBridgeFrame(spanFrameJSON()) // uses "spanId" not "id" — shape mismatch
        #expect(frame?.kind == .span)
        #expect(frame?.span == nil)
    }

    @Test func validControlParsesWithoutDecodingRequest() {
        let frame = parseBridgeFrame(controlFrameJSON())
        #expect(frame?.kind == .control)
        #expect(frame?.request == nil)
    }

    /// Mirrors `server.ts` never validating a request payload's full shape
    /// before relaying it: a payload that is an object but missing fields
    /// `NetworkRequest` requires still counts as a parseable frame.
    @Test func requestPayloadMissingRequiredFieldStillParsesButDoesNotDecode() {
        let frame = parseBridgeFrame(#"{"type":"request","payload":{"id":"req-1"}}"#)
        #expect(frame?.kind == .request)
        #expect(frame?.request == nil)
    }

    @Test(
        "malformed or hostile frames are dropped",
        arguments: [
            "not json at all",
            #"{"payload":{"a":1}}"#,
            #"{"type":"request"}"#,
            #"{"type":"request","payload":null}"#,
            #"{"type":"bogus","payload":{}}"#,
            #"{"type":"control","payload":"a string"}"#,
            #"{"type":"control","payload":42}"#,
        ]
    )
    func malformedFramesDrop(_ raw: String) {
        #expect(parseBridgeFrame(raw) == nil)
    }

    @Test func oversizedFrameDrops() {
        let raw = requestFrameJSON()
        #expect(parseBridgeFrame(raw, maxBytes: raw.utf8.count - 1) == nil)
        #expect(parseBridgeFrame(raw, maxBytes: raw.utf8.count) != nil)
    }
}

// MARK: - Fake peer

/// In-process `BridgeRelayPeer` fake — no socket, so `BridgeHub` relay logic
/// is exercised without ever binding a real port.
private final class FakeBridgePeer: BridgeRelayPeer, @unchecked Sendable {
    let id = BridgePeerID()
    private let lock = NSLock()
    private var _sent: [String] = []

    var sent: [String] {
        lock.lock()
        defer { lock.unlock() }
        return _sent
    }

    func send(_ raw: String) {
        lock.lock()
        _sent.append(raw)
        lock.unlock()
    }
}

// MARK: - BridgeHub relay

@Suite("BridgeHub")
struct BridgeHubTests {
    @Test func controlFrameRelaysToOtherPeersNotSender() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        let other = FakeBridgePeer()
        await hub.addPeer(sender)
        await hub.addPeer(other)

        let raw = controlFrameJSON()
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.kind == .control)
        #expect(other.sent == [raw])
        #expect(sender.sent.isEmpty)
    }

    @Test func spanFrameRelaysToOtherPeersNotSender() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        let other = FakeBridgePeer()
        await hub.addPeer(sender)
        await hub.addPeer(other)

        let raw = spanFrameJSON()
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.kind == .span)
        #expect(other.sent == [raw])
        #expect(sender.sent.isEmpty)
    }

    /// The span counterpart to `requestFrameRelaysAndSurfacesOnRequestsStream`
    /// — this is the exact gap the task brief calls out: before this, a
    /// `.span` frame was relayed but silently thrown away by the desktop's
    /// own capture side, because nothing decoded it or yielded it anywhere.
    @Test func spanFrameSurfacesOnSpansStream() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        await hub.addPeer(sender)

        let raw = validSpanFrameJSON()
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.span?.id == "span-root-1")

        var iterator = hub.spans.makeAsyncIterator() // `spans` is `nonisolated` — no actor hop needed
        let received = await iterator.next()
        #expect(received?.id == "span-root-1")
        #expect(received?.traceId == "trace-1")
    }

    @Test func requestFrameRelaysAndSurfacesOnRequestsStream() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        let other = FakeBridgePeer()
        await hub.addPeer(sender)
        await hub.addPeer(other)

        let raw = requestFrameJSON(id: "req-42")
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.request?.id == "req-42")
        #expect(other.sent == [raw])

        var iterator = hub.requests.makeAsyncIterator() // `requests` is `nonisolated` — no actor hop needed
        let received = await iterator.next()
        #expect(received?.id == "req-42")
    }

    @Test func malformedFrameIsDroppedNotRelayed() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        let other = FakeBridgePeer()
        await hub.addPeer(sender)
        await hub.addPeer(other)

        let result = await hub.ingest("not json", from: sender.id)

        #expect(result == nil)
        #expect(other.sent.isEmpty)
    }

    @Test func peerCountTracksAddAndRemove() async {
        let hub = BridgeHub()
        let peer = FakeBridgePeer()
        #expect(await hub.peerCount == 0)
        await hub.addPeer(peer)
        #expect(await hub.peerCount == 1)
        await hub.removePeer(peer.id)
        #expect(await hub.peerCount == 0)
    }
}

// MARK: - BridgeConnection ordering

/// Regression coverage for a prior bug: `BridgeConnection` used to spawn a
/// fresh, independently-created `Task { await hub.ingest(...) }` per
/// assembled frame, and Swift gives no ordering guarantee between two
/// independently-created `Task`s reaching their first suspension point — so
/// a burst of back-to-back frames from one peer could reach `hub.ingest`
/// (and thus get relayed / surface on `hub.requests`) out of order. The fix
/// funnels every frame through a single per-connection consumer `Task` fed
/// by an `AsyncStream`, so this asserts strict FIFO holds under a burst.
///
/// `NWConnection(host:port:using:)` only describes a connection; it performs
/// no I/O until `.start(queue:)` is called, which this suite never does — so
/// this stays consistent with `ServerTests.swift` never binding a real port.
@Suite("BridgeConnection ordering")
struct BridgeConnectionOrderingTests {
    @Test func burstOfFramesIngestsInSubmissionOrder() async {
        let hub = BridgeHub()
        let dummyConnection = NWConnection(host: "127.0.0.1", port: 1, using: .tcp)
        let peer = BridgeConnection(connection: dummyConnection, hub: hub, maxFrameBytes: BridgeWireLimits.maxFrameBytes)

        let frameCount = 50
        for i in 0..<frameCount {
            let raw = Data(requestFrameJSON(id: "req-\(i)").utf8)
            peer.handleAssembledMessage(raw, opcode: .text)
        }

        var iterator = hub.requests.makeAsyncIterator() // `requests` is `nonisolated` — no actor hop needed
        var seenIDs: [String] = []
        for _ in 0..<frameCount {
            guard let request = await iterator.next() else { break }
            seenIDs.append(request.id)
        }

        #expect(seenIDs == (0..<frameCount).map { "req-\($0)" })
    }
}
