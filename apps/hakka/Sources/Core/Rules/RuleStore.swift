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
/// Change signaling follows the hub's pattern (`BridgeHub.requests`): an
/// `AsyncStream` of post-mutation snapshots, `nonisolated` so consuming it
/// needs no actor hop. The store is the source of truth; a UI model mirrors
/// the latest snapshot the way `TrafficModel` mirrors `TrafficStore`.
public actor RuleStore {
    /// Snapshots after every list mutation (add/replace, enable, disable,
    /// remove, clear) — not after `recordHit`, which mirrors the device
    /// engines counting a match without notifying listeners. Each snapshot
    /// fully describes the list, so a consumer that falls behind and
    /// re-reads on the next element loses nothing.
    public nonisolated let changes: AsyncStream<[RuleEntry]>

    private var entries: [RuleEntry] = []
    private let changeContinuation: AsyncStream<[RuleEntry]>.Continuation

    public init() {
        var continuation: AsyncStream<[RuleEntry]>.Continuation?
        changes = AsyncStream { continuation = $0 }
        changeContinuation = continuation!
    }

    deinit {
        changeContinuation.finish()
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
    /// the rule by id with the new enabled value. Unknown ids are a no-op.
    public func setEnabled(_ enabled: Bool, id: String) {
        guard let index = entries.firstIndex(where: { $0.id == id }),
            entries[index].isEnabled != enabled
        else { return }
        entries[index].isEnabled = enabled
        notifyChanged()
    }

    /// Remove an entry by id. Unknown ids are a no-op.
    public func remove(id: String) {
        let before = entries.count
        entries.removeAll { $0.id == id }
        guard entries.count != before else { return }
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
        changeContinuation.yield(entries)
    }
}
