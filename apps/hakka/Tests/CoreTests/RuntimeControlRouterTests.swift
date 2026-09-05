import Foundation
import HakkaCommon
@testable import HakkaServer
import Testing

struct RuntimeControlRouterTests {
    private func receive(_ raw: String, router: inout RuntimeControlRouter, sender: UUID, now: TimeInterval = ProcessInfo.processInfo.systemUptime) throws -> [RuntimeControlRouter.Delivery] {
        try router.receive(#require(parseRuntimeControlFrame(raw)), raw: raw, from: sender, now: now)
    }

    private func hello(_ role: String = "runtime", capabilities: String = "\"mock.clear\"") -> String {
        "{\"type\":\"runtime.hello\",\"payload\":{\"role\":\"\(role)\",\"runtime\":\"ios\",\"protocolVersion\":1,\"capabilities\":[\(capabilities)]}}"
    }

    private func target(_ deliveries: [RuntimeControlRouter.Delivery]) throws -> String {
        for (_, raw) in deliveries {
            if case let .welcome(id) = parseRuntimeControlFrame(raw) {
                return id
            }
        }
        throw CocoaError(.coderValueNotFound)
    }

    private func request(_ target: String, id: String = "command-1") -> String {
        "{\"type\":\"control.request\",\"payload\":{\"commandId\":\"\(id)\",\"targetId\":\"\(target)\",\"timeoutMs\":5000,\"command\":{\"kind\":\"mock.clear\"}}}"
    }

    private func result(_ deliveries: [RuntimeControlRouter.Delivery]) throws -> RuntimeControlResult {
        guard let raw = deliveries.first?.1, case let .result(response) = parseRuntimeControlFrame(raw) else { throw CocoaError(.coderValueNotFound) }
        return response
    }

    @Test func targetsRouteExactlyAndOnlyChosenPeerCanAcknowledge() throws {
        var router = RuntimeControlRouter()
        let controller = UUID(), a = UUID(), b = UUID()
        _ = router.add(controller); _ = router.add(a); _ = router.add(b)
        let targetA = try target(receive(hello(), router: &router, sender: a))
        _ = try receive(hello(), router: &router, sender: b)
        let inventory = try receive(hello("controller", capabilities: ""), router: &router, sender: controller)
        let snapshots = inventory.compactMap { delivery -> [RuntimeControlTarget]? in
            if case let .targets(values) = parseRuntimeControlFrame(delivery.1) {
                return values
            }; return nil
        }
        #expect(snapshots.first?.count == 2)
        let raw = request(targetA)
        let sent = try receive(raw, router: &router, sender: controller)
        #expect(sent.count == 1)
        #expect(sent.first?.0 == a)
        #expect(sent.first?.1 == raw)
        let ack = try #require(encodeRuntimeControlFrame("control.result", payload: RuntimeControlResult(commandId: "command-1", targetId: targetA)))
        #expect(try receive(ack, router: &router, sender: b).isEmpty)
        let untrustedAck = String(ack.dropLast()) + ",\"secret\":\"credential\"}"
        let delivered = try receive(untrustedAck, router: &router, sender: a)
        #expect(delivered.first?.0 == controller)
        #expect(delivered.allSatisfy { !$0.1.contains("credential") })
        #expect(try result(delivered).status == "applied")
        #expect(try receive(ack, router: &router, sender: a).isEmpty)
        #expect(try result(receive(raw, router: &router, sender: controller)).error == "apply_failed")
    }

    @Test func timeoutDisconnectAndReconnectInvalidatePendingIdentity() throws {
        var router = RuntimeControlRouter()
        let controller = UUID(), runtime = UUID()
        _ = router.add(controller); _ = router.add(runtime)
        _ = try receive(hello("controller", capabilities: ""), router: &router, sender: controller)
        let targetID = try target(receive(hello(), router: &router, sender: runtime))
        let start = 100.0
        _ = try receive(request(targetID), router: &router, sender: controller, now: start)
        #expect(router.expire("command-1", now: start).isEmpty)
        #expect(try result(router.expire("command-1", now: start + 6)).error == "timeout")
        _ = try receive(request(targetID, id: "command-2"), router: &router, sender: controller)
        #expect(try result(router.remove(runtime)).error == "target_disconnected")
        _ = router.add(runtime)
        let replacement = try target(receive(hello(), router: &router, sender: runtime))
        #expect(replacement != targetID)
        #expect(try result(receive(request(targetID, id: "command-3"), router: &router, sender: controller)).error == "target_not_found")
    }

    @Test func legacyAndUnsupportedPeersNeverReceiveTargetedMutations() throws {
        var router = RuntimeControlRouter()
        let controller = UUID(), legacy = UUID(), unsupported = UUID()
        _ = router.add(controller); _ = router.add(legacy); _ = router.add(unsupported)
        let unsupportedID = try target(receive(hello(capabilities: ""), router: &router, sender: unsupported))
        let inventory = try receive(hello("controller", capabilities: ""), router: &router, sender: controller)
        let legacyIDs = inventory.compactMap { pair -> String? in
            if case let .targets(targets) = parseRuntimeControlFrame(pair.1) {
                return targets.first(where: { !$0.acknowledged })?.id
            }; return nil
        }
        let legacyID = try #require(legacyIDs.first)
        #expect(try result(receive(request(legacyID), router: &router, sender: controller)).error == "legacy_unacknowledged")
        #expect(try result(receive(request(unsupportedID, id: "command-2"), router: &router, sender: controller)).error == "unsupported_capability")
    }
}

private final class RuntimeTestPeer: BridgeRelayPeer, @unchecked Sendable {
    let id = UUID()
    private let lock = NSLock()
    private var frames: [String] = []
    func send(_ raw: String) {
        lock.lock(); frames.append(raw); lock.unlock()
    }

    func close() {}
    var sent: [String] {
        lock.lock(); defer { lock.unlock() }; return frames
    }
}

struct RuntimeControlHubTests {
    @Test func targetedFramesNeverEnterLegacyBroadcast() async throws {
        let hub = BridgeHub()
        let controller = RuntimeTestPeer(), runtime = RuntimeTestPeer(), bystander = RuntimeTestPeer()
        await hub.addPeer(controller); await hub.addPeer(runtime); await hub.addPeer(bystander)
        await hub.ingest(#"{"type":"runtime.hello","payload":{"role":"runtime","runtime":"ios","protocolVersion":1,"capabilities":["mock.clear"]}}"#, from: runtime.id)
        await hub.ingest(#"{"type":"runtime.hello","payload":{"role":"controller","runtime":"unknown","protocolVersion":1,"capabilities":[]}}"#, from: controller.id)
        let ids = runtime.sent.compactMap { raw -> String? in
            if case let .welcome(id) = parseRuntimeControlFrame(raw) {
                return id
            }; return nil
        }
        let id = try #require(ids.first)
        let raw = "{\"type\":\"control.request\",\"payload\":{\"commandId\":\"hub-command\",\"targetId\":\"\(id)\",\"timeoutMs\":5000,\"command\":{\"kind\":\"mock.clear\"}}}"
        #expect(await hub.broadcast(raw) == 0)
        await hub.ingest(raw, from: controller.id)
        #expect(runtime.sent.last == raw)
        #expect(bystander.sent.isEmpty)
        let result = try #require(encodeRuntimeControlFrame("control.result", payload: RuntimeControlResult(commandId: "hub-command", targetId: id)))
        await hub.ingest(result, from: runtime.id)
        #expect(controller.sent.contains { value in
            if case let .result(response) = parseRuntimeControlFrame(value) {
                return response.status == "applied"
            }; return false
        })
        #expect(bystander.sent.isEmpty)
        await hub.closeAllPeers()
    }
}
