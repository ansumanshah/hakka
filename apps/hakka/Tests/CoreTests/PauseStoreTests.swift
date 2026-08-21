import Foundation
import HakkaCommon
import Testing
@testable import HakkaCore

/// Behavioral coverage for the desktop pause inbox's local store: ingest,
/// replace-by-id for a retransmitted pause, remove, and rollback. Mirrors
/// `RuleStoreTests`'s shape.
@Suite("PauseStore")
struct PauseStoreTests {
    private func pause(id: String = "pause-1", device: String = "iphone-a", phase: BreakpointPhase = .request) -> PendingPause {
        PendingPause(
            pauseId: id,
            ruleId: "rule-1",
            phase: phase,
            device: device,
            request: BreakpointPausedRequestSnapshot(url: "https://api.test/x", method: "GET", headers: [:]),
            response: phase == .response
                ? BreakpointPausedResponseSnapshot(status: 200, headers: [:], body: "{}")
                : nil
        )
    }

    @Test func ingestAppendsAndNotifies() async throws {
        let store = PauseStore()
        var changes = store.changes.makeAsyncIterator()

        await store.ingest(pause(id: "pause-a"))
        await store.ingest(pause(id: "pause-b"))

        let first = await changes.next()
        #expect(first?.map(\.pauseId) == ["pause-a"])
        let second = await changes.next()
        #expect(second?.map(\.pauseId) == ["pause-a", "pause-b"])
        #expect(await store.pauses().count == 2)
    }

    /// A device that never saw an ack (or that hits the same breakpoint
    /// again while still paused) may resend `breakpoint.paused` with the
    /// same `pauseId` — the store must update that one entry in place, not
    /// grow a second inbox row for what is really one live pause.
    @Test func ingestWithDuplicatePauseIDReplacesInsteadOfDuplicating() async throws {
        let store = PauseStore()

        await store.ingest(pause(id: "dup", device: "iphone-a"))
        await store.ingest(pause(id: "dup", device: "iphone-a-retransmit"))

        let all = await store.pauses()
        #expect(all.count == 1)
        #expect(all.first?.device == "iphone-a-retransmit")
    }

    @Test func removeReturnsTheRemovedEntryAndNotifies() async throws {
        let store = PauseStore()
        await store.ingest(pause(id: "pause-a"))
        var changes = store.changes.makeAsyncIterator()
        _ = await changes.next() // the ingest above

        let removed = await store.remove(pauseId: "pause-a")

        #expect(removed?.pauseId == "pause-a")
        #expect(await store.isEmpty)
        let snapshot = await changes.next()
        #expect(snapshot?.isEmpty == true)
    }

    @Test func removeUnknownIDIsANoOp() async throws {
        let store = PauseStore()
        await store.ingest(pause(id: "pause-a"))

        let removed = await store.remove(pauseId: "does-not-exist")

        #expect(removed == nil)
        #expect(await store.pauses().count == 1)
    }

    /// The rollback half of a failed resume/abort send: the exact entry
    /// (same payload, same arrival time) comes back, not a fresh copy.
    @Test func restoreReinsertsTheExactEntry() async throws {
        let store = PauseStore()
        let entry = pause(id: "pause-a")
        await store.ingest(entry)
        let removed = try #require(await store.remove(pauseId: "pause-a"))

        await store.restore(removed)

        let all = await store.pauses()
        #expect(all == [entry])
    }

    /// A pause that re-arrived while a rollback was still in flight must
    /// not be clobbered by the stale restore.
    @Test func restoreIsANoOpWhenAnEntryWithThatIDAlreadyExists() async throws {
        let store = PauseStore()
        let original = pause(id: "pause-a", device: "iphone-a")
        await store.ingest(original)
        let removed = try #require(await store.remove(pauseId: "pause-a"))
        await store.ingest(pause(id: "pause-a", device: "iphone-b"))

        await store.restore(removed)

        let all = await store.pauses()
        #expect(all.count == 1)
        #expect(all.first?.device == "iphone-b", "a re-arrival must win over a stale rollback")
    }

    @Test func responsePhasePauseCarriesTheResponseSnapshot() async throws {
        let store = PauseStore()
        await store.ingest(pause(id: "pause-a", phase: .response))

        let stored = try #require(await store.pause(id: "pause-a"))
        #expect(stored.phase == .response)
        #expect(stored.response?.status == 200)
    }
}
