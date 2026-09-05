// @generated — do not edit. Synced from ios/Sources/UI/Helpers/WindowScene+Active.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import UIKit

// MARK: - UIApplication + Active Scene

extension UIApplication {
    /// The foreground-active `UIWindowScene` among `connectedScenes`, falling
    /// back to the first connected scene if none is currently active (e.g.
    /// mid scene-transition). Multi-scene hosts (iPad Stage Manager, Mac
    /// Catalyst) can have several connected scenes at once; picking `.first`
    /// unconditionally risks attaching the bubble/overlay to a background or
    /// inactive scene that never actually renders.
    var activeWindowScene: UIWindowScene? {
        let scenes = connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
    }
}
#endif // canImport(UIKit)
