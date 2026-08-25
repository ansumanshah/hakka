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

/// A well-formed `.console` payload — matches `fixtures/console/log-batch.json`'s shape.
private func consoleFrameJSON(id: String = "log-1") -> String {
    #"{"type":"console","payload":[{"id":"\#(id)","timestamp":1732000000000,"level":"warn","message":"cache stale"}]}"#
}

/// A well-formed `.storage` payload — matches `fixtures/storage/defaults-snapshot.json`'s shape.
private func storageFrameJSON(store: String = "defaults") -> String {
    #"{"type":"storage","payload":{"store":"\#(store)","timestamp":1732000000000,"entries":{"theme":"dark"}}}"#
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

    /// Mirrors `protocol.ts`'s `type === 'console' && Array.isArray(payload)`
    /// check: an object-shaped `.console` payload is malformed on the wire,
    /// same as a string or number payload, even though it would satisfy the
    /// old kind-agnostic "object or array" shallow check. Before this was
    /// kind-specific, this hub relayed a frame the TS hub drops.
    @Test func consolePayloadShapedAsAnObjectDrops() {
        #expect(parseBridgeFrame(#"{"type":"console","payload":{"id":"log-1"}}"#) == nil)
    }

    /// `.storage` is the ONLY non-console kind whose payload must be a
    /// non-array object — mirroring `protocol.ts`'s `!Array.isArray(payload)`
    /// check, which appears solely on the `storage` branch of
    /// `parseBridgeMessage`.
    @Test func storagePayloadShapedAsAnArrayDrops() {
        #expect(parseBridgeFrame(#"{"type":"storage","payload":[1,2,3]}"#) == nil)
    }

    /// The other half: `.request`/`.span`/`.control` payloads accept EITHER
    /// shape. `protocol.ts`'s checks for these three are just `typeof
    /// payload === 'object' && payload !== null`, and in JS `typeof` on an
    /// array is also `'object'` — so an array-shaped payload is still
    /// parseable for these kinds, just as it is in the TS hub. Only a JSON
    /// scalar (string/number/bool) is malformed for them, covered by
    /// `malformedFramesDrop`'s `{"type":"control","payload":42}` case.
    @Test(
        "array-shaped payload still parses for request/span/control",
        arguments: ["request", "span", "control"]
    )
    func nonConsolePayloadShapedAsAnArrayStillParses(_ type: String) {
        let frame = parseBridgeFrame(#"{"type":"\#(type)","payload":[1,2,3]}"#)
        #expect(frame?.kind.rawValue == type)
    }

    @Test func oversizedFrameDrops() {
        let raw = requestFrameJSON()
        #expect(parseBridgeFrame(raw, maxBytes: raw.utf8.count - 1) == nil)
        #expect(parseBridgeFrame(raw, maxBytes: raw.utf8.count) != nil)
    }

    @Test func validConsoleFrameDecodesIntoLogEntryArray() {
        let frame = parseBridgeFrame(consoleFrameJSON())
        #expect(frame?.kind == .console)
        #expect(frame?.console?.count == 1)
        #expect(frame?.console?.first?.id == "log-1")
        #expect(frame?.console?.first?.level == .warn)
        #expect(frame?.console?.first?.message == "cache stale")
    }

    @Test func validStorageFrameDecodesIntoStorageSnapshot() {
        let frame = parseBridgeFrame(storageFrameJSON())
        #expect(frame?.kind == .storage)
        #expect(frame?.storage?.store == "defaults")
        #expect(frame?.storage?.entries == ["theme": "dark"])
    }

    /// Mirrors `spanPayloadMissingRequiredFieldStillParsesButDoesNotDecode`:
    /// a `.console` payload that is an array (satisfying the shallow
    /// envelope check) but whose elements don't satisfy `LogEntry` still
    /// counts as a parseable frame — relayed, just not decoded.
    @Test func consolePayloadWithMalformedEntryStillParsesButDoesNotDecode() {
        let frame = parseBridgeFrame(#"{"type":"console","payload":[{"notAnEntry":true}]}"#)
        #expect(frame?.kind == .console)
        #expect(frame?.console == nil)
    }

    @Test func storagePayloadMissingRequiredFieldStillParsesButDoesNotDecode() {
        let frame = parseBridgeFrame(#"{"type":"storage","payload":{"store":"defaults"}}"#)
        #expect(frame?.kind == .storage)
        #expect(frame?.storage == nil)
    }

    /// The forward-compat contract this whole change depends on: a frame
    /// whose `type` names a kind this build predates — indistinguishable
    /// from a real future kind, since `BridgeFrameKind(rawValue:)` treats
    /// any unrecognized string identically — is dropped like malformed
    /// JSON, never thrown. This is what let `console`/`storage` themselves
    /// ship to a fleet with already-installed older desktop builds.
    @Test func unknownFutureFrameKindIsDroppedNotThrown() {
        #expect(parseBridgeFrame(#"{"type":"metrics","payload":{"cpu":0.5}}"#) == nil)
    }
}

// MARK: - Fake peer

/// In-process `BridgeRelayPeer` fake — no socket, so `BridgeHub` relay logic
/// is exercised without ever binding a real port.
private final class FakeBridgePeer: BridgeRelayPeer, @unchecked Sendable {
    let id = BridgePeerID()
    private let lock = NSLock()
    private var _sent: [String] = []
    private var _closed = false

    var sent: [String] {
        lock.lock()
        defer { lock.unlock() }
        return _sent
    }

    var closed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return _closed
    }

    func send(_ raw: String) {
        lock.lock()
        _sent.append(raw)
        lock.unlock()
    }

    func close() {
        lock.lock()
        _closed = true
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
        // Subscribe BEFORE ingesting — a per-subscription stream only
        // fans out to continuations already registered when `ingest`
        // yields, unlike the old stored/shared stream a subscribe after
        // ingest could still drain.
        var iterator = await hub.subscribeSpans().makeAsyncIterator()

        let raw = validSpanFrameJSON()
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.span?.id == "span-root-1")

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
        // Subscribe before ingesting — see `spanFrameSurfacesOnSpansStream`.
        var iterator = await hub.subscribeRequests().makeAsyncIterator()

        let raw = requestFrameJSON(id: "req-42")
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.request?.id == "req-42")
        #expect(other.sent == [raw])

        let received = await iterator.next()
        #expect(received?.id == "req-42")
        #expect(received?.peerID == sender.id)
        #expect(received?.deviceLabel == "Device 1", "the first peer ever seen must get the first device label")
    }

    /// `BridgeDeviceLabeler`'s contract, exercised through `ingest` rather
    /// than directly: distinct peers get distinct, stable-per-peer labels,
    /// assigned in the order their first frame arrives.
    @Test func distinctSendersGetDistinctStableDeviceLabels() async {
        let hub = BridgeHub()
        let peerA = FakeBridgePeer()
        let peerB = FakeBridgePeer()
        await hub.addPeer(peerA)
        await hub.addPeer(peerB)

        var iterator = await hub.subscribeRequests().makeAsyncIterator()

        _ = await hub.ingest(requestFrameJSON(id: "a-1"), from: peerA.id)
        let fromA1 = await iterator.next()

        _ = await hub.ingest(requestFrameJSON(id: "b-1"), from: peerB.id)
        let fromB1 = await iterator.next()

        _ = await hub.ingest(requestFrameJSON(id: "a-2"), from: peerA.id)
        let fromA2 = await iterator.next()

        #expect(fromA1?.deviceLabel == "Device 1")
        #expect(fromB1?.deviceLabel == "Device 2")
        #expect(fromA2?.deviceLabel == "Device 1", "the same peer's later frame keeps its original label")
    }

    @Test func consoleFrameRelaysToOtherPeersNotSender() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        let other = FakeBridgePeer()
        await hub.addPeer(sender)
        await hub.addPeer(other)

        let raw = consoleFrameJSON()
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.kind == .console)
        #expect(other.sent == [raw])
        #expect(sender.sent.isEmpty)
    }

    /// The console counterpart to `spanFrameSurfacesOnSpansStream`.
    @Test func consoleFrameSurfacesOnConsoleEntriesStream() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        await hub.addPeer(sender)
        // Subscribe before ingesting — see `spanFrameSurfacesOnSpansStream`.
        var iterator = await hub.subscribeConsoleEntries().makeAsyncIterator()

        let result = await hub.ingest(consoleFrameJSON(id: "log-42"), from: sender.id)
        #expect(result?.console?.first?.id == "log-42")

        let received = await iterator.next()
        #expect(received?.first?.id == "log-42")
    }

    @Test func storageFrameRelaysToOtherPeersNotSender() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        let other = FakeBridgePeer()
        await hub.addPeer(sender)
        await hub.addPeer(other)

        let raw = storageFrameJSON()
        let result = await hub.ingest(raw, from: sender.id)

        #expect(result?.kind == .storage)
        #expect(other.sent == [raw])
        #expect(sender.sent.isEmpty)
    }

    /// The storage counterpart to `spanFrameSurfacesOnSpansStream`.
    @Test func storageFrameSurfacesOnStorageSnapshotsStream() async {
        let hub = BridgeHub()
        let sender = FakeBridgePeer()
        await hub.addPeer(sender)
        // Subscribe before ingesting — see `spanFrameSurfacesOnSpansStream`.
        var iterator = await hub.subscribeStorageSnapshots().makeAsyncIterator()

        let result = await hub.ingest(storageFrameJSON(store: "keychain-redacted"), from: sender.id)
        #expect(result?.storage?.store == "keychain-redacted")

        let received = await iterator.next()
        #expect(received?.store == "keychain-redacted")
        #expect(received?.entries == ["theme": "dark"])
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

    /// `BridgeServer.stop()`'s hub-side half: closing every connected peer,
    /// not just deregistering it. Before `closeAllPeers()` existed, `stop()`
    /// only cancelled the listener, leaving accepted `NWConnection`s (and
    /// their `hub` registration) alive indefinitely.
    @Test func closeAllPeersClosesAndDeregistersEveryPeer() async {
        let hub = BridgeHub()
        let a = FakeBridgePeer()
        let b = FakeBridgePeer()
        await hub.addPeer(a)
        await hub.addPeer(b)

        await hub.closeAllPeers()

        #expect(a.closed)
        #expect(b.closed)
        #expect(await hub.peerCount == 0)
    }
}

// MARK: - BridgeConnection ordering

/// Regression coverage for a prior bug: `BridgeConnection` used to spawn a
/// fresh, independently-created `Task { await hub.ingest(...) }` per
/// assembled frame, and Swift gives no ordering guarantee between two
/// independently-created `Task`s reaching their first suspension point — so
/// a burst of back-to-back frames from one peer could reach `hub.ingest`
/// (and thus get relayed / surface on `hub.subscribeRequests()`) out of
/// order. The fix
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
        // Subscribe before sending any frames — see
        // `BridgeHubTests.spanFrameSurfacesOnSpansStream`.
        var iterator = await hub.subscribeRequests().makeAsyncIterator()

        let frameCount = 50
        for i in 0..<frameCount {
            let raw = Data(requestFrameJSON(id: "req-\(i)").utf8)
            peer.handleAssembledMessage(raw, opcode: .text)
        }

        var seenIDs: [String] = []
        for _ in 0..<frameCount {
            guard let request = await iterator.next() else { break }
            seenIDs.append(request.id)
        }

        #expect(seenIDs == (0..<frameCount).map { "req-\($0)" })
    }
}
