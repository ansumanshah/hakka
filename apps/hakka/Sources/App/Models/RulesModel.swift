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
    private let traffic: TrafficModel

    private(set) var entries: [RuleEntry] = []
    /// The throttle profile picker's value; `none` restores full speed.
    var throttleProfile: ThrottleProfile = .none
    /// Transient delivery feedback from the last action — device count or
    /// the failure, never silence.
    private(set) var deliveryNote: String?

    init(traffic: TrafficModel) {
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
    func setEnabled(_ enabled: Bool, entry: RuleEntry) {
        let updated = RuleEntry(id: entry.id, payload: entry.payload, isEnabled: enabled, hitCount: entry.hitCount)
        Task {
            do {
                await traffic.rules.setEnabled(enabled, id: entry.id)
                let delivered = try await traffic.send(installCommand(for: updated))
                note(delivered)
            } catch {
                note(error)
            }
        }
    }

    func remove(_ entry: RuleEntry) {
        Task {
            do {
                await traffic.rules.remove(id: entry.id)
                let delivered = try await traffic.send(removalCommand(for: entry))
                note(delivered)
            } catch {
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
