import Foundation
import HakkaCommon

/// Ordered, observable list of breakpoint pauses currently held on connected
/// devices, waiting on this desktop to resume or abort them. Mirrors
/// `RuleStore`'s shape on purpose — same `changes` `AsyncStream` of full
/// snapshots, `nonisolated` so consuming needs no actor hop — keyed here by
/// `pauseId` instead of a rule id.
///
/// This store only ever holds local bookkeeping: it never touches the wire
/// itself (same split as `RuleStore`). `PauseInboxModel` owns sending
/// `breakpoint.resume`/`.abort` and calls `remove`/`restore` around it.
public actor PauseStore {
    public nonisolated let changes: AsyncStream<[PendingPause]>
    private var entries: [PendingPause] = []
    private let changeContinuation: AsyncStream<[PendingPause]>.Continuation

    public init() {
        var continuation: AsyncStream<[PendingPause]>.Continuation?
        changes = AsyncStream { continuation = $0 }
        changeContinuation = continuation!
    }

    deinit {
        changeContinuation.finish()
    }

    public var isEmpty: Bool { entries.isEmpty }
    public func pauses() -> [PendingPause] { entries }
    public func pause(id: String) -> PendingPause? { entries.first { $0.pauseId == id } }

    /// Records a newly arrived pause. Replace-by-id: a duplicate
    /// `breakpoint.paused` for a `pauseId` already held (a retransmit, or a
    /// device that never saw an ack and paused again for the same fired
    /// breakpoint) updates the existing entry in place rather than adding a
    /// second inbox row for what is really one live pause.
    public func ingest(_ pause: PendingPause) {
        entries.removeAll { $0.pauseId == pause.pauseId }
        entries.append(pause)
        notifyChanged()
    }

    /// Removes an entry by pause id — the local half of a resume, abort, or
    /// timeout; the caller owns the wire send. Returns the removed entry so
    /// a caller that needs to roll back an exact failed send can hand it
    /// straight to `restore`.
    @discardableResult
    public func remove(pauseId: String) -> PendingPause? {
        guard let index = entries.firstIndex(where: { $0.pauseId == pauseId }) else { return nil }
        let entry = entries.remove(at: index)
        notifyChanged()
        return entry
    }

    /// Reinserts a previously removed entry — the rollback half of
    /// `remove(pauseId:)`, same shape as `RuleStore.restore(_:at:)`. A no-op
    /// if an entry with the same id is already present (a re-arrival raced
    /// ahead of the rollback).
    public func restore(_ entry: PendingPause) {
        guard !entries.contains(where: { $0.pauseId == entry.pauseId }) else { return }
        entries.append(entry)
        notifyChanged()
    }

    private func notifyChanged() {
        changeContinuation.yield(entries)
    }
}
