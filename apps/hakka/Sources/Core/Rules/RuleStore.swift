import Foundation
import HakkaCommon

/// Ordered, observable list of the mock/breakpoint rules the desktop pushes
/// to connected devices — the authoring side of the control channel.
/// `RuleEntry` carries the payloads; this actor owns order, toggles, hit
/// counts, and change notification.
///
/// Throttle is deliberately not stored here: `throttle.set` selects one
/// device-global profile, not an entry in a list, so it goes straight to
/// `ControlSender` without a store.
///
/// Change signaling follows `BridgeHub`'s per-subscription broadcast-stream
/// pattern (ADR 0013): `subscribeChanges()` returns a FRESH `AsyncStream` of
/// post-mutation snapshots on every call, backed by its own continuation in
/// `changeSubscribers`, rather than one stream stored for the store's whole
/// lifetime. A stored single-consumer stream dies for good the instant a
/// suspended consumer's `next()` is abandoned by cancellation — exactly what
/// happens to `RulesModel.observe()`'s `for await` when its window closes —
/// so a later subscriber would see nothing, silently, forever. The store is
/// the source of truth; a UI model mirrors the latest snapshot the way
/// `TrafficModel` mirrors `TrafficStore`.
public actor RuleStore {
    private var entries: [RuleEntry] = []

    // Subscriber continuations, keyed by a subscription id private to that
    // one `subscribeChanges()` call — same shape as `BridgeHub`'s
    // `requestSubscribers` etc.
    private var changeSubscribers: [UUID: AsyncStream<[RuleEntry]>.Continuation] = [:]

    public init() {}

    deinit {
        for continuation in changeSubscribers.values { continuation.finish() }
    }

    /// Registers a fresh subscription and returns its stream. Only sees
    /// snapshots yielded *after* this call — unlike the old stored stream, a
    /// fresh `AsyncStream` starts empty, so a consumer that needs the
    /// current list first should call `rules()` before iterating (see
    /// `RulesModel.observe()`).
    public func subscribeChanges() -> AsyncStream<[RuleEntry]> {
        let id = UUID()
        let (stream, continuation) = AsyncStream<[RuleEntry]>.makeStream()
        changeSubscribers[id] = continuation
        continuation.onTermination = { [weak self] _ in
            Task { await self?.unsubscribeChanges(id) }
        }
        return stream
    }

    private func unsubscribeChanges(_ id: UUID) {
        changeSubscribers.removeValue(forKey: id)
    }

    // MARK: - Reads

    public var count: Int { entries.count }
    public var isEmpty: Bool { entries.isEmpty }

    /// All entries in authoring order.
    public func rules() -> [RuleEntry] { entries }

    public func rule(id: String) -> RuleEntry? {
        entries.first { $0.id == id }
    }

    // MARK: - Mutations

    /// Add a rule, or replace the existing entry with the same id — the same
    /// replace-by-id semantics every device engine applies to an add, so the
    /// desktop list and device state stay in step. Throws
    /// `ControlWireError` for any payload that could not be encoded onto the
    /// wire (hostile id, empty pattern, invalid delay): an entry that can
    /// never be pushed must not enter the list.
    @discardableResult
    public func add(_ payload: RuleEntry.Payload, id: String) throws -> RuleEntry {
        let entry = RuleEntry(id: id, payload: payload)
        // Validate by encoding: the wire contract is the single definition of
        // a legal rule, so authoring-time and send-time can't drift apart.
        _ = try ControlCommandEncoder.encodePayload(installCommand(for: entry))
        entries.removeAll { $0.id == id }
        entries.append(entry)
        notifyChanged()
        return entry
    }

    /// Flip an entry's enable toggle. The wire has no toggle command — the
    /// caller re-sends `installCommand(for:)` and the device engine replaces
    /// the rule by id with the new enabled value. Unknown ids are a no-op
    /// (returns nil). Returns the entry's previous enabled value otherwise,
    /// so a caller that mutates local state ahead of a wire send can flip it
    /// straight back if that send fails — an exact rollback, not a guess.
    @discardableResult
    public func setEnabled(_ enabled: Bool, id: String) -> Bool? {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return nil }
        let previous = entries[index].isEnabled
        guard previous != enabled else { return previous }
        entries[index].isEnabled = enabled
        notifyChanged()
        return previous
    }

    /// Remove an entry by id. Unknown ids are a no-op (returns nil).
    /// Returns the removed entry and the index it occupied, so a caller can
    /// hand both to `restore(_:at:)` for an exact rollback — same payload,
    /// same `hitCount`, same list position — if the wire send that was
    /// supposed to follow the removal fails.
    @discardableResult
    public func remove(id: String) -> (entry: RuleEntry, index: Int)? {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return nil }
        let entry = entries.remove(at: index)
        notifyChanged()
        return (entry, index)
    }

    /// Reinserts a previously removed entry at its prior index — the other
    /// half of `remove(id:)`'s rollback contract. Clamped to the current
    /// count so a store that changed shape underneath (another mutation
    /// raced in while the failed send was in flight) still gets a valid
    /// insert instead of a trap; the position is best-effort in that case,
    /// but the entry itself — payload and `hitCount` — is exact because the
    /// caller hands back the very snapshot `remove` returned.
    public func restore(_ entry: RuleEntry, at index: Int) {
        let clamped = min(max(index, 0), entries.count)
        entries.insert(entry, at: clamped)
        notifyChanged()
    }

    /// Clear the local store. Sends nothing: this store never touches the
    /// wire, and a caller that wants the devices cleared too must emit one
    /// removal per entry itself (the contract has `mock.clear` but no
    /// `breakpoint.clear`, and a blanket clear would also delete device-side
    /// rules this desktop never authored).
    public func removeAll() {
        guard !entries.isEmpty else { return }
        entries.removeAll()
        notifyChanged()
    }

    /// Count one match against an entry and publish the new snapshot —
    /// the Rules surface's hit counters are live reflections of captured
    /// traffic. The change stream buffers unbounded, so a burst of matches
    /// can't drop the final count.
    public func recordHit(id: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return }
        entries[index].hitCount += 1
        notifyChanged()
    }

    private func notifyChanged() {
        for continuation in changeSubscribers.values {
            continuation.yield(entries)
        }
    }
}
