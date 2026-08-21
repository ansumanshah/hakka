import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

/// Behavioral coverage for the desktop rule list: authoring order,
/// replace-by-id adds, toggles, removals, hit counting, and change
/// notification. Stream assertions consume snapshots one at a time between
/// mutations — `AsyncStream` buffers yields until read, so each `next()`
/// returns exactly the snapshot the preceding mutation produced, in order.
@Suite("RuleStore")
struct RuleStoreTests {
    private func mockPayload(pattern: String = "/api/users") -> RuleEntry.Payload {
        .mock(MockRuleInput(pattern: pattern, response: MockResponse(status: 200, body: "[]")))
    }

    @Test func addPreservesAuthoringOrderAndNotifies() async throws {
        let store = RuleStore()
        var changes = store.changes.makeAsyncIterator()

        try await store.add(mockPayload(), id: "rule-a")
        try await store.add(.breakpoint(BreakpointInput(pattern: "/checkout", on: .both)), id: "rule-b")

        let first = await changes.next()
        #expect(first?.map(\.id) == ["rule-a"])
        let second = await changes.next()
        #expect(second?.map(\.id) == ["rule-a", "rule-b"])
        #expect(await store.rules().map(\.id) == ["rule-a", "rule-b"])
        #expect(await store.count == 2)
    }

    /// The engines replace an add with a duplicate id rather than rejecting
    /// it or keeping a copy — the store must agree, or its list and device
    /// state drift apart on the first edit of an existing rule.
    @Test func addWithDuplicateIDReplacesInsteadOfDuplicating() async throws {
        let store = RuleStore()
        var changes = store.changes.makeAsyncIterator()

        try await store.add(mockPayload(pattern: "/v1"), id: "dup")
        try await store.add(mockPayload(pattern: "/v2"), id: "dup")
        _ = await changes.next()

        let replacement = await changes.next()
        #expect(replacement?.count == 1)
        #expect(replacement?.first?.id == "dup")
        let rule = try #require(await store.rule(id: "dup"))
        #expect(rule.payload == mockPayload(pattern: "/v2"))
    }

    @Test("wire-invalid input is refused at authoring time", arguments: [
        "has space",
        "a/b/c",
        String(repeating: "a", count: 65),
    ])
    func addThrowsForWireInvalidInput(_ id: String) async {
        let store = RuleStore()
        await #expect(throws: ControlWireError.self) {
            try await store.add(mockPayload(), id: id)
        }
        #expect(await store.isEmpty)
    }

    @Test func setEnabledTogglesAndNotifies() async throws {
        let store = RuleStore()
        var changes = store.changes.makeAsyncIterator()
        try await store.add(mockPayload(), id: "rule-a")
        _ = await changes.next()

        await store.setEnabled(false, id: "rule-a")
        let disabled = await changes.next()
        #expect(disabled?.first?.isEnabled == false)

        await store.setEnabled(true, id: "rule-a")
        let reenabled = await changes.next()
        #expect(reenabled?.first?.isEnabled == true)

        // Unknown ids and no-op toggles change nothing.
        await store.setEnabled(false, id: "nope")
        await store.setEnabled(true, id: "rule-a")
        try await store.add(mockPayload(pattern: "/z"), id: "rule-z")
        let next = await changes.next()
        #expect(next?.map(\.id) == ["rule-a", "rule-z"])
    }

    @Test func removeDeletesAndNotifies() async throws {
        let store = RuleStore()
        var changes = store.changes.makeAsyncIterator()
        try await store.add(mockPayload(), id: "rule-a")
        try await store.add(mockPayload(pattern: "/z"), id: "rule-z")
        _ = await changes.next()
        _ = await changes.next()

        await store.remove(id: "rule-a")
        let afterRemove = await changes.next()
        #expect(afterRemove?.map(\.id) == ["rule-z"])

        // Removing an unknown id is silent — the next snapshot belongs to the
        // next real mutation, not to a spurious no-op notification.
        await store.remove(id: "never-existed")
        await store.remove(id: "rule-z")
        let afterSecondRemove = await changes.next()
        #expect(afterSecondRemove?.isEmpty == true)
        #expect(await store.isEmpty)
    }

    @Test func removeAllClearsAndNotifies() async throws {
        let store = RuleStore()
        var changes = store.changes.makeAsyncIterator()
        try await store.add(mockPayload(), id: "rule-a")
        try await store.add(.breakpoint(BreakpointInput(pattern: "/x")), id: "rule-b")
        _ = await changes.next()
        _ = await changes.next()

        await store.removeAll()
        let cleared = await changes.next()
        #expect(cleared?.isEmpty == true)
        #expect(await store.count == 0)
    }

    /// Hits publish live snapshots (the Rules surface's counters are
    /// reflections of captured traffic), and an unknown id stays silent.
    /// The stream buffers unbounded, so nothing is ever dropped — only
    /// reordered ahead of later mutations, which this test steps through
    /// rather than assuming.
    @Test func recordHitPublishesLiveSnapshots() async throws {
        let store = RuleStore()
        var changes = store.changes.makeAsyncIterator()
        try await store.add(mockPayload(), id: "rule-a")
        _ = await changes.next()

        await store.recordHit(id: "rule-a")
        await store.recordHit(id: "rule-a")
        await store.recordHit(id: "nope")
        try await store.add(mockPayload(pattern: "/z"), id: "rule-z")

        // Two hit snapshots, then the add's snapshot — drain in order.
        let firstHit = await changes.next()
        #expect(firstHit?.first?.hitCount == 1)
        let secondHit = await changes.next()
        #expect(secondHit?.first?.hitCount == 2)
        let added = await changes.next()
        #expect(added?.map(\.id) == ["rule-a", "rule-z"])
        #expect(added?.first?.hitCount == 2)
    }

    // MARK: - Wire mapping

    @Test func installCommandCarriesTheEntryToggleOverThePayload() async throws {
        let store = RuleStore()
        let added = try await store.add(
            .mock(MockRuleInput(
                pattern: "/api/cart",
                method: "POST",
                response: MockResponse(status: 200, body: "{}"),
                enabled: true
            )),
            id: "cart-mock"
        )
        await store.setEnabled(false, id: "cart-mock")
        let disabledEntry = try #require(await store.rule(id: "cart-mock"))

        guard case let .mockAdd(id, rule) = installCommand(for: disabledEntry) else {
            Issue.record("expected a mock add command")
            return
        }
        #expect(id == "cart-mock")
        #expect(rule.enabled == false)
        #expect(added.isEnabled)

        guard case let .breakpointAdd(breakpointID, breakpoint) = installCommand(
            for: RuleEntry(id: "bp-1", payload: .breakpoint(BreakpointInput(pattern: "/x", on: .response, enabled: true)))
        ) else {
            Issue.record("expected a breakpoint add command")
            return
        }
        #expect(breakpointID == "bp-1")
        #expect(breakpoint.id == "bp-1")
        #expect(breakpoint.on == .response)
        #expect(breakpoint.enabled)
    }

    @Test func removalCommandSelectsTheRightKind() {
        let mockEntry = RuleEntry(id: "m-1", payload: .mock(MockRuleInput(pattern: "/x", response: MockResponse(status: 200))))
        let breakpointEntry = RuleEntry(id: "b-1", payload: .breakpoint(BreakpointInput(pattern: "/x")))

        #expect(removalCommand(for: mockEntry) == .mockRemove(id: "m-1"))
        #expect(removalCommand(for: breakpointEntry) == .breakpointRemove(id: "b-1"))
    }
}
