import Foundation
import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaServer

/// In-process fake device — same shape as `ServerTests`' relay fake: no
/// socket, so sender behavior is exercised without ever binding a port.
private final class FakeDevice: BridgeRelayPeer, @unchecked Sendable {
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

/// The desktop's control send path: typed command -> encoded frame ->
/// `BridgeHub.broadcast` -> every connected device. Frames must be
/// byte-identical to what `ControlFrameEncoder` pins, parseable by this
/// app's own `parseBridgeFrame`, and re-parseable by the device-side
/// `parseControlCommand`; hostile input must fail loudly before any write.
@Suite("ControlSender")
struct ControlSenderTests {
    @Test func deliversPinnedFrameBytesToEveryConnectedDevice() async throws {
        let hub = BridgeHub()
        let phone = FakeDevice()
        let browser = FakeDevice()
        await hub.addPeer(phone)
        await hub.addPeer(browser)

        let delivered = try await ControlSender(hub: hub).send(.mockClear)

        #expect(delivered == 2)
        let expected = #"{"payload":{"kind":"mock.clear"},"type":"control"}"#
        #expect(phone.sent == [expected])
        #expect(browser.sent == [expected])
    }

    @Test("every command kind survives the full wire path", arguments: [
        ControlCommand.mockAdd(
            id: "m-1",
            rule: MockRuleInput(pattern: "/api/users", response: MockResponse(status: 200, body: "[]"))
        ),
        ControlCommand.mockRemove(id: "m-1"),
        ControlCommand.mockClear,
        ControlCommand.breakpointAdd(
            id: "bp-1",
            breakpoint: BreakpointInput(pattern: "/checkout", method: "post", on: .both)
        ),
        ControlCommand.breakpointRemove(id: "bp-1"),
        ControlCommand.throttleSet(profile: .custom, latencyMs: 200, downloadKbps: 500),
    ])
    func commandRoundTripsToDevice(_ command: ControlCommand) async throws {
        let hub = BridgeHub()
        let device = FakeDevice()
        await hub.addPeer(device)

        try await ControlSender(hub: hub).send(command)

        let raw = try #require(device.sent.first)
        let frame = try #require(parseBridgeFrame(raw))
        #expect(frame.kind == .control)
        let envelope = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        let payload = try #require(envelope["payload"] as? [String: Any])
        #expect(parseControlCommand(payload) == command)
    }

    @Test func sendReturnsZeroWhenNoDevicesAreConnected() async throws {
        let delivered = try await ControlSender(hub: BridgeHub()).send(
            .throttleSet(profile: .slow3g, latencyMs: nil, downloadKbps: nil)
        )
        #expect(delivered == 0)
    }

    @Test func hostileCommandThrowsBeforeAnyWrite() async {
        let hub = BridgeHub()
        let device = FakeDevice()
        await hub.addPeer(device)
        let sender = ControlSender(hub: hub)

        await #expect(throws: ControlWireError.self) {
            try await sender.send(
                .mockAdd(id: "../../etc/passwd", rule: MockRuleInput(pattern: "/x", response: MockResponse(status: 200)))
            )
        }
        #expect(device.sent.isEmpty)
        #expect(await hub.peerCount == 1)
    }

    @Test func oversizedFrameThrowsBeforeAnyWrite() async {
        let hub = BridgeHub()
        let device = FakeDevice()
        await hub.addPeer(device)

        await #expect(throws: ControlWireError.oversizedFrame(byteCount: 50, limit: 4)) {
            try await ControlSender(hub: hub).send(.mockClear, maxFrameBytes: 4)
        }
        #expect(device.sent.isEmpty)
    }

    /// The hub-level guard behind the sender: a malformed frame handed
    /// straight to `broadcast` is dropped exactly like one arriving over a
    /// socket, never written to any peer.
    @Test("broadcast drops malformed frames without writing", arguments: [
        "not json at all",
        #"{"type":"control"}"#,
        #"{"type":"control","payload":"a string"}"#,
        #"{"type":"control","payload":42}"#,
    ])
    func broadcastDropsMalformedFrames(_ raw: String) async {
        let hub = BridgeHub()
        let device = FakeDevice()
        await hub.addPeer(device)

        #expect(await hub.broadcast(raw) == 0)
        #expect(device.sent.isEmpty)
    }

    /// The flagship story end to end: a rule authored in the desktop store
    /// reaches a connected device as a frame the device's own parser accepts.
    @Test func ruleStoreEntryFlowsToDeviceEndToEnd() async throws {
        let hub = BridgeHub()
        let device = FakeDevice()
        await hub.addPeer(device)
        let store = RuleStore()
        let sender = ControlSender(hub: hub)

        try await store.add(
            .mock(MockRuleInput(pattern: "/api/cart", method: "POST", response: MockResponse(status: 200, body: "{}"))),
            id: "cart-mock"
        )
        let entry = try #require(await store.rule(id: "cart-mock"))
        try await sender.send(installCommand(for: entry))

        let raw = try #require(device.sent.first)
        let envelope = try #require(try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any])
        #expect(envelope["type"] as? String == "control")
        let payload = try #require(envelope["payload"] as? [String: Any])
        #expect(parseControlCommand(payload) == .mockAdd(id: "cart-mock", rule: MockRuleInput(
            pattern: "/api/cart",
            method: "POST",
            response: MockResponse(status: 200, body: "{}")
        )))
    }
}
