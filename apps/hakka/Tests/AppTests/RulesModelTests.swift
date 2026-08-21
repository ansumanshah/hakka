import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

/// A `RuleControlChannel` fake standing in for `TrafficModel`, which needs a
/// live `BridgeServer` to construct. `send` is scripted per test: either it
/// throws, or it returns a device count — `0` included, since that is a
/// legitimate outcome (no devices connected) and not a failure.
@MainActor
private final class FakeControlChannel: RuleControlChannel {
    let rules = RuleStore()
    var sendResult: Result<Int, Error> = .success(1)
    private(set) var sentCommands: [ControlCommand] = []

    func send(_ command: ControlCommand) async throws -> Int {
        sentCommands.append(command)
        return try sendResult.get()
    }
}

/// Coverage for the state-divergence fix: `RulesModel.setEnabled` and
/// `.remove` mutate `RuleStore` first (so the UI reacts instantly) and roll
/// back on a thrown send error, so the local store and device state can
/// never diverge silently. Each test that proves the fix also documents,
/// in its own name, the behavior that would fail without it — run against
/// the pre-fix mutate-and-never-rollback code, `sendThrows` cases fail.
@Suite("RulesModel rollback")
@MainActor
struct RulesModelTests {
    private func mockEntry(id: String = "rule-a", hitCount: Int = 0) -> RuleEntry {
        RuleEntry(
            id: id,
            payload: .mock(MockRuleInput(pattern: "/api/users", response: MockResponse(status: 200, body: "[]"))),
            isEnabled: true,
            hitCount: hitCount
        )
    }

    // MARK: - setEnabled

    @Test func setEnabledSendThrowsLeavesStoreUnchanged() async throws {
        let channel = FakeControlChannel()
        let entry = try await channel.rules.add(mockEntry().payload, id: "rule-a")
        channel.sendResult = .failure(ControlWireError.encodingFailed("boom"))
        let model = RulesModel(traffic: channel)

        model.setEnabled(false, entry: entry)
        try await Task.sleep(for: .milliseconds(50))

        let stored = try #require(await channel.rules.rule(id: "rule-a"))
        #expect(stored.isEnabled == true, "a failed send must not leave the toggle flipped")
        #expect(model.deliveryNote?.hasPrefix("Failed") == true)
    }

    @Test func setEnabledSendReturnsZeroKeepsTheMutation() async throws {
        let channel = FakeControlChannel()
        let entry = try await channel.rules.add(mockEntry().payload, id: "rule-a")
        channel.sendResult = .success(0)
        let model = RulesModel(traffic: channel)

        model.setEnabled(false, entry: entry)
        try await Task.sleep(for: .milliseconds(50))

        let stored = try #require(await channel.rules.rule(id: "rule-a"))
        #expect(stored.isEnabled == false, "no devices connected is not a failure")
        #expect(model.deliveryNote == "Saved — no devices connected")
    }

    @Test func setEnabledSuccessKeepsTheMutation() async throws {
        let channel = FakeControlChannel()
        let entry = try await channel.rules.add(mockEntry().payload, id: "rule-a")
        channel.sendResult = .success(2)
        let model = RulesModel(traffic: channel)

        model.setEnabled(false, entry: entry)
        try await Task.sleep(for: .milliseconds(50))

        let stored = try #require(await channel.rules.rule(id: "rule-a"))
        #expect(stored.isEnabled == false)
        #expect(model.deliveryNote == "Delivered to 2 devices")
    }

    // MARK: - remove

    @Test func removeSendThrowsRestoresHitCountAndPosition() async throws {
        let channel = FakeControlChannel()
        _ = try await channel.rules.add(mockEntry(id: "rule-a").payload, id: "rule-a")
        let target = try await channel.rules.add(mockEntry(id: "rule-b").payload, id: "rule-b")
        await channel.rules.recordHit(id: "rule-b")
        await channel.rules.recordHit(id: "rule-b")
        await channel.rules.recordHit(id: "rule-b")
        let entryWithHits = try #require(await channel.rules.rule(id: "rule-b"))
        _ = try await channel.rules.add(mockEntry(id: "rule-c").payload, id: "rule-c")
        channel.sendResult = .failure(ControlWireError.encodingFailed("boom"))
        let model = RulesModel(traffic: channel)

        model.remove(target)
        try await Task.sleep(for: .milliseconds(50))

        let ids = await channel.rules.rules().map(\.id)
        #expect(ids == ["rule-a", "rule-b", "rule-c"], "a failed send must restore the exact list position")
        let restored = try #require(await channel.rules.rule(id: "rule-b"))
        #expect(restored.hitCount == entryWithHits.hitCount, "a failed send must restore the exact hitCount, not reset it")
        #expect(model.deliveryNote?.hasPrefix("Failed") == true)
    }

    @Test func removeSendReturnsZeroKeepsTheMutation() async throws {
        let channel = FakeControlChannel()
        let target = try await channel.rules.add(mockEntry().payload, id: "rule-a")
        channel.sendResult = .success(0)
        let model = RulesModel(traffic: channel)

        model.remove(target)
        try await Task.sleep(for: .milliseconds(50))

        #expect(await channel.rules.rule(id: "rule-a") == nil, "no devices connected is not a failure")
        #expect(model.deliveryNote == "Saved — no devices connected")
    }

    @Test func removeSuccessKeepsTheMutation() async throws {
        let channel = FakeControlChannel()
        let target = try await channel.rules.add(mockEntry().payload, id: "rule-a")
        channel.sendResult = .success(1)
        let model = RulesModel(traffic: channel)

        model.remove(target)
        try await Task.sleep(for: .milliseconds(50))

        #expect(await channel.rules.rule(id: "rule-a") == nil)
        #expect(model.deliveryNote == "Delivered to 1 device")
    }
}
