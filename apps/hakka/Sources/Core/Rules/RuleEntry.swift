import Foundation
import HakkaCommon

/// One authored rule in the desktop `RuleStore`: the engine payload pushed
/// to devices (`MockRuleInput`/`BreakpointInput` reused from HakkaCommon —
/// the wire vocabulary devices already implement), plus the local
/// bookkeeping the wire contract cannot carry: authoring order, the enable
/// toggle, and a hit counter.
///
/// `isEnabled` is the single source of truth for enabled state; the
/// payloads carry their own `enabled` too (they are the same types the
/// engines take), and `installCommand(for:)` copies the entry's toggle over
/// it when mapping to the wire.
public struct RuleEntry: Sendable, Equatable, Identifiable {
    /// What to install on devices when this entry matches.
    public enum Payload: Sendable, Equatable {
        case mock(MockRuleInput)
        case breakpoint(BreakpointInput)
    }

    /// The wire id — also the replace-by-id key on every device engine, so
    /// re-adding with the same id replaces and removing by it deletes.
    /// Must satisfy `^[A-Za-z0-9_-]{1,64}$` (validated by `RuleStore.add`).
    public let id: String
    /// The entry's enable toggle. There is no wire "toggle" command: flipping
    /// this re-issues the add with the new enabled value (replace-by-id).
    public var isEnabled: Bool
    /// How often this rule matched. Purely local bookkeeping — the control
    /// channel is fire-and-forget with no feedback frames, so device-side
    /// counts never arrive here; the desktop counts matches it observes in
    /// its own captured traffic instead.
    public var hitCount: Int
    public let payload: Payload

    public init(id: String, payload: Payload, isEnabled: Bool = true, hitCount: Int = 0) {
        self.id = id
        self.payload = payload
        self.isEnabled = isEnabled
        self.hitCount = hitCount
    }
}
