import Foundation
import HakkaCommon
import HakkaCore
import Observation

/// The Rules surface's model: mirrors the `RuleStore` into displayable
/// entries and owns the actions the surface offers — toggling, removing,
/// and the device-global throttle profile. Takes `TrafficModel` by
/// injection (the store and sender live there, beside the hub); the app
/// model composes the two, they never find each other sideways.
@MainActor @Observable
final class RulesModel {
    private let traffic: RuleControlChannel

    private(set) var entries: [RuleEntry] = []
    /// The throttle profile picker's value; `none` restores full speed.
    var throttleProfile: ThrottleProfile = .none
    /// Transient delivery feedback from the last action — device count or
    /// the failure, never silence.
    private(set) var deliveryNote: String?

    init(traffic: RuleControlChannel) {
        self.traffic = traffic
    }

    /// Mirrors the store for as long as the calling task lives. Seeds from
    /// the current snapshot first — the change stream only yields mutations.
    func observe() async {
        entries = await traffic.rules.rules()
        for await snapshot in traffic.rules.changes {
            entries = snapshot
        }
    }

    /// Flipping the toggle re-issues the add with the new enabled value —
    /// the wire contract has no toggle command, and replace-by-id keeps the
    /// rule listed on the device while disabled.
    ///
    /// Mutates the local store first, then rolls back on a thrown send
    /// error — chosen over sending first and mutating on success. Send-first
    /// would leave the toggle visibly lagging the tap for the round trip to
    /// every device (this list can render before the first device even
    /// connects, so "lagging" can mean indefinitely), and a failure still
    /// has to leave the UI at the pre-action state either way — the two
    /// orderings only differ in whether that state shows up before or after
    /// the request, not in whether rollback logic is needed. Mutate-first
    /// keeps the toggle instantaneous and pays for it with exactly one
    /// rollback path, which `RuleStore.setEnabled` makes exact by handing
    /// back the prior value instead of RulesModel guessing it back to `!enabled`.
    /// A `0`-device send is not a failure — `note(_:Int)` reports it as
    /// "saved, no devices" and the local mutation stands.
    func setEnabled(_ enabled: Bool, entry: RuleEntry) {
        let updated = RuleEntry(id: entry.id, payload: entry.payload, isEnabled: enabled, hitCount: entry.hitCount)
        Task {
            guard let previous = await traffic.rules.setEnabled(enabled, id: entry.id) else { return }
            do {
                let delivered = try await traffic.send(installCommand(for: updated))
                note(delivered)
            } catch {
                await traffic.rules.setEnabled(previous, id: entry.id)
                note(error)
            }
        }
    }

    /// Same mutate-first-then-rollback ordering as `setEnabled`, and for the
    /// same reason: the row disappears the instant the trash icon is tapped
    /// instead of lingering through a round trip that may never resolve (no
    /// devices connected). The rollback has to be exact — the entry back at
    /// its old list position with its old `hitCount`, not appended fresh
    /// with the counter reset — so it goes through `RuleStore.remove(id:)`,
    /// which hands back the removed entry and its index instead of just
    /// deleting, and `restore(_:at:)`, which reinserts both rather than
    /// re-adding (`add` always appends, which would silently reorder the
    /// list on every failed remove).
    func remove(_ entry: RuleEntry) {
        Task {
            guard let removed = await traffic.rules.remove(id: entry.id) else { return }
            do {
                let delivered = try await traffic.send(removalCommand(for: entry))
                note(delivered)
            } catch {
                await traffic.rules.restore(removed.entry, at: removed.index)
                note(error)
            }
        }
    }

    /// Throttle is one device-global setting, not a list rule — the picker
    /// sends it directly.
    func applyThrottle() {
        Task {
            do {
                let delivered = try await traffic.send(
                    .throttleSet(profile: throttleProfile, latencyMs: nil, downloadKbps: nil)
                )
                note(delivered)
            } catch {
                note(error)
            }
        }
    }

    /// Freeze a captured response into a mock and install it.
    ///
    /// Sends BEFORE storing, which is the opposite order from `setEnabled`
    /// and `remove` above, on purpose. Those two flip a control the user is
    /// looking at, so the list has to move under their finger and roll back
    /// if the send fails. Promotion has no such control: the user picked an
    /// action on a captured request and waits for one note either way, so
    /// there is nothing to keep responsive and no reason to admit a rule to
    /// the store that no device ever received. `send` encodes through the
    /// same `ControlCommandEncoder` that `add` validates with, so a payload
    /// that survives the send cannot then be rejected by the store.
    ///
    /// Returns the number of devices written to. Zero is a real outcome, not
    /// a failure: the rule is kept so it ships to the next device that
    /// connects.
    ///
    /// `pattern`/`method` let a caller install a match edited from what was
    /// actually captured — the promote-to-mock sheet's editable fields.
    /// `nil` (the default) installs the capture's own match unchanged, same
    /// as before this parameter existed.
    @discardableResult
    func promote(_ request: NetworkRequest, pattern: String? = nil, method: String? = nil) async throws -> Int {
        let entry = try CapturedMockConverter.entry(from: request, pattern: pattern, method: method)
        let delivered = try await traffic.send(installCommand(for: entry))
        try await traffic.rules.add(entry.payload, id: entry.id)
        return delivered
    }

    /// The "+ Add rule" flow's counterpart to `promote` above: a mock or
    /// breakpoint authored from scratch in `AddRuleSheet`, not frozen from a
    /// capture. Same send-before-store ordering as `promote`, for the same
    /// reason — this rule has no existing row on screen to keep responsive,
    /// so there is nothing to lose by waiting for the send before it enters
    /// the list, and every reason not to store a rule no device received.
    ///
    /// Random id, unlike `promote`'s deterministic one: a capture's
    /// promotion dedupes by endpoint on purpose (re-promoting the same
    /// request replaces it), but two rules a person authors by hand for the
    /// same endpoint — a happy-path mock next to a disabled failure-mode one,
    /// say — are deliberately distinct entries, not a replace-by-id
    /// collision. `RuleStore.add` still validates the payload by encoding it
    /// (empty pattern, hostile id, etc.) — a bad id here can only come from
    /// this `UUID`, which is always wire-safe, so in practice only the
    /// payload itself can fail that check.
    ///
    /// Awaited directly by the sheet (unlike the list actions above, which
    /// fire-and-forget a `Task`) so a validation failure — an empty pattern,
    /// a non-numeric status — can be shown inline and the sheet kept open
    /// and editable, rather than rolling back a row that was never added to
    /// the list in the first place. Sets `deliveryNote` on success only,
    /// same footer the list actions share; a failure has nothing to report
    /// there since nothing changed.
    @discardableResult
    func createRule(_ payload: RuleEntry.Payload) async throws -> Int {
        let id = "rule-\(UUID().uuidString.lowercased())"
        let entry = RuleEntry(id: id, payload: payload)
        let delivered = try await traffic.send(installCommand(for: entry))
        try await traffic.rules.add(entry.payload, id: entry.id)
        note(delivered)
        return delivered
    }

    private func note(_ delivered: Int) {
        deliveryNote = delivered == 0
            ? "Saved — no devices connected"
            : "Delivered to \(delivered) device\(delivered == 1 ? "" : "s")"
        clearNoteLater()
    }

    private func note(_ error: Error) {
        deliveryNote = "Failed: \(error.localizedDescription)"
        clearNoteLater()
    }

    private func clearNoteLater() {
        let current = deliveryNote
        Task {
            try? await Task.sleep(for: .seconds(2.5))
            if deliveryNote == current { deliveryNote = nil }
        }
    }
}
