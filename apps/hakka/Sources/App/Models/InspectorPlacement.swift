import Foundation

/// The inspector can stay beside traffic for a wide-window scan or move
/// below it when a request needs more horizontal room. The values are kept
/// stable because they are user preferences and command-menu identifiers.
enum InspectorPlacement: String, CaseIterable {
    case trailing
    case bottom

    static let placementKey = "hakka.inspector.placement"
    static let visibilityKey = "hakka.inspector.visible"

    static func value(from rawValue: String) -> InspectorPlacement {
        InspectorPlacement(rawValue: rawValue) ?? .trailing
    }
}
