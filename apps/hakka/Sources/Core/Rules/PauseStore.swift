import Foundation
import HakkaCommon

/// Ordered, observable list of breakpoint pauses currently held on connected
/// devices, waiting on this desktop to resume or abort them. Mirrors
/// `RuleStore`'s shape on purpose — same `subscribeChanges()`
/// per-subscription broadcast stream of full snapshots (ADR 0013) — keyed
/// here by `pauseId` instead of a rule id.
///
/// This store only ever holds local bookkeeping: it never touches the wire
/// itself (same split as `RuleStore`). `PauseInboxModel` owns sending
/// `breakpoint.resume`/`.abort` and calls `remove`/`restore` around it.
public actor PauseStore {
    private var entries: [PendingPause] = []

    // Subscriber continuations, keyed by a subscription id private to that
    // one `subscribeChanges()` call — same shape as `RuleStore`.
    private var changeSubscribers: [UUID: AsyncStream<[PendingPause]>.Continuation] = [:]

    public init() {}

    deinit {
        for continuation in changeSubscribers.values { continuation.finish() }
    }

    /// Registers a fresh subscription and returns its stream. Only sees
    /// snapshots yielded *after* this call — a fresh `AsyncStream` starts
    /// empty, so a consumer that needs the current list first should call
    /// `pauses()` before iterating (see `PauseInboxModel.observe()`).
    public func subscribeChanges() -> AsyncStream<[PendingPause]> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<[PendingPause]>.makeStream()
        changeSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeChanges(id) }
        }
        return stream
    }

    private func unsubscribeChanges(_ id: UUID) {
        changeSubscribers.removeValue(forKey: id)
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
        for continuation in changeSubscribers.values {
            continuation.yield(entries)
        }
    }
}
