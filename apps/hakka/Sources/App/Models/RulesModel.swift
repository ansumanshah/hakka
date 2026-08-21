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
