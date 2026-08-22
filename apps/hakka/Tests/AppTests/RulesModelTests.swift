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

/// Promotion sequences the other way round from the toggles above: send
/// first, store on success. These pin that invariant, because the failure it
/// prevents is invisible in the UI. A rule that entered the store after a
/// failed send would sit in the Rules list looking installed forever.
@Suite("RulesModel promotion")
@MainActor
struct RulesModelPromotionTests {
    private func capture(status: Int? = 200, error: String? = nil) -> NetworkRequest {
        NetworkRequest(
            id: "cap-1",
            url: "https://api.example.com/users?page=2",
            method: .get,
            status: status,
            startTime: 0,
            responseBody: "[]",
            error: error
        )
    }

    @Test func aFailedSendStoresNothing() async throws {
        let channel = FakeControlChannel()
        channel.sendResult = .failure(ControlWireError.encodingFailed("boom"))
        let model = RulesModel(traffic: channel)

        await #expect(throws: (any Error).self) { try await model.promote(capture()) }

        let count = await channel.rules.count
        #expect(count == 0, "a rule no device received must not appear in the Rules list")
    }

    @Test func aSuccessfulSendStoresTheRule() async throws {
        let channel = FakeControlChannel()
        let model = RulesModel(traffic: channel)

        let delivered = try await model.promote(capture())

        #expect(delivered == 1)
        let count = await channel.rules.count
        #expect(count == 1)
    }

    @Test func noDevicesConnectedStillStoresTheRule() async throws {
        let channel = FakeControlChannel()
        channel.sendResult = .success(0)
        let model = RulesModel(traffic: channel)

        let delivered = try await model.promote(capture())

        #expect(delivered == 0)
        let count = await channel.rules.count
        #expect(count == 1, "zero devices is not a failure; the rule ships to the next one that connects")
    }

    @Test func promoteWithAnOverriddenMatchInstallsTheEditedPatternNotTheCapturedOne() async throws {
        // The promote-to-mock sheet's Install button hands `promote` its
        // (possibly edited) match; this pins that the override actually
        // reaches the installed rule, not just the id it's keyed under.
        let channel = FakeControlChannel()
        let model = RulesModel(traffic: channel)

        _ = try await model.promote(capture(), pattern: "https://api.example.com/v2/users", method: "PUT")

        let stored = try #require(await channel.rules.rules().first)
        guard case .mock(let rule) = stored.payload else {
            Issue.record("expected a mock payload")
            return
        }
        #expect(rule.pattern == "https://api.example.com/v2/users")
        #expect(rule.method == "PUT")
        #expect(stored.id == CapturedMockConverter.ruleID(method: "PUT", pattern: "https://api.example.com/v2/users"))
    }

    @Test func anErroredCaptureIsRefusedBeforeAnythingIsSent() async throws {
        let channel = FakeControlChannel()
        let model = RulesModel(traffic: channel)

        await #expect(throws: (any Error).self) {
            try await model.promote(capture(status: nil, error: "connection refused"))
        }

        #expect(channel.sentCommands.isEmpty, "a failed capture has no response to freeze")
        let count = await channel.rules.count
        #expect(count == 0)
    }
}

/// `createRule` is the "+ Add rule" sheet's counterpart to `promote` — same
/// send-before-store ordering, but authoring a payload from scratch instead
/// of freezing a capture, so its own suite pins the two differences that
/// matter: an id it invents itself (not derived from any request), and a
/// bad payload (empty pattern) getting caught by the same wire validation
/// `promote`/`RuleStore.add` already share, before anything sends.
@Suite("RulesModel rule creation")
@MainActor
struct RulesModelCreationTests {
    private func mockPayload(pattern: String = "/api/new", status: Int = 200) -> RuleEntry.Payload {
        .mock(MockRuleInput(pattern: pattern, response: MockResponse(status: status, body: "{}")))
    }

    @Test func aSuccessfulCreateStoresTheRuleAndSetsTheNote() async throws {
        let channel = FakeControlChannel()
        channel.sendResult = .success(2)
        let model = RulesModel(traffic: channel)

        let delivered = try await model.createRule(mockPayload())

        #expect(delivered == 2)
        let stored = await channel.rules.rules()
        #expect(stored.count == 1)
        #expect(stored.first?.payload == mockPayload())
        #expect(model.deliveryNote == "Delivered to 2 devices")
    }

    @Test func noDevicesConnectedStillStoresTheCreatedRule() async throws {
        let channel = FakeControlChannel()
        channel.sendResult = .success(0)
        let model = RulesModel(traffic: channel)

        let delivered = try await model.createRule(mockPayload())

        #expect(delivered == 0)
        let count = await channel.rules.count
        #expect(count == 1, "zero devices is not a failure; the rule ships to the next one that connects")
    }

    @Test func aFailedSendStoresNothing() async throws {
        let channel = FakeControlChannel()
        channel.sendResult = .failure(ControlWireError.encodingFailed("boom"))
        let model = RulesModel(traffic: channel)

        await #expect(throws: (any Error).self) { try await model.createRule(mockPayload()) }

        let count = await channel.rules.count
        #expect(count == 0, "a rule no device received must not appear in the Rules list")
    }

    @Test func twoCreationsForTheSamePatternAreDistinctEntries() async throws {
        let channel = FakeControlChannel()
        let model = RulesModel(traffic: channel)

        _ = try await model.createRule(mockPayload(pattern: "/api/dup"))
        _ = try await model.createRule(mockPayload(pattern: "/api/dup"))

        let count = await channel.rules.count
        #expect(count == 2, "authored rules use a random id, unlike promote's deterministic one — two hand-authored rules for the same endpoint are distinct entries, not a replace-by-id collision")
    }

    /// `RuleStore.add`'s own encode-to-validate check catches this — same
    /// wire taxonomy `RuleStoreTests.addThrowsForWireInvalidInput` pins.
    /// Nothing lands in the store either way; unlike `promote`'s pre-flight
    /// capture check, this one isn't guaranteed to run before the fake's
    /// `send` (the real encoder only runs inside `RuleStore.add`, which the
    /// fake doesn't stand in for), so this test doesn't assert on
    /// `sentCommands`.
    @Test func invalidPatternIsRefusedAndNothingIsStored() async throws {
        let channel = FakeControlChannel()
        let model = RulesModel(traffic: channel)

        await #expect(throws: (any Error).self) { try await model.createRule(mockPayload(pattern: "")) }

        let count = await channel.rules.count
        #expect(count == 0)
    }
}
