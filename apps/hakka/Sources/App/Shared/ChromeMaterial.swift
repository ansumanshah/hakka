import Foundation
import SwiftUI

/// Which custom chrome surface a view represents.
enum ChromeSurfaceKind {
    /// A pane that should inherit its containing window's system material.
    case panel
    /// A floating sheet — rounded corners to match the window it presents
    /// over (Artboard 8's `.glass-sheet`).
    case sheet
}

/// Centralizes the one custom Liquid Glass treatment the app needs: floating
/// sheets. Window chrome, sidebars, toolbars, and scrolling panes inherit the
/// native system treatment. Painting materials over those standard containers
/// creates stacked blur layers and prevents automatic scroll-edge behavior.
enum ChromeMaterial {
    /// Pure decision function so both branches of the gate are testable
    /// regardless of which macOS this happens to build and run on. The view
    /// modifier below still uses `#available` to call `glassEffect` — a
    /// compiler-checked gate, not just a runtime one — but this is what
    /// `ChromeMaterialTests` exercises directly.
    static func usesGlass(for version: OperatingSystemVersion) -> Bool {
        version.majorVersion >= 26
    }

    /// Whether this process would take the Liquid Glass branch right now.
    static var isGlassAvailable: Bool {
        usesGlass(for: ProcessInfo.processInfo.operatingSystemVersion)
    }

    fileprivate static let sheetShape = AnyShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
}

private struct ChromeMaterialModifier: ViewModifier {
    var kind: ChromeSurfaceKind

    func body(content: Content) -> some View {
        switch kind {
        case .panel:
            content
        case .sheet:
            if #available(macOS 26.0, *) {
                content.glassEffect(.regular, in: ChromeMaterial.sheetShape)
            } else {
                content.background(.regularMaterial, in: ChromeMaterial.sheetShape)
            }
        }
    }
}

extension View {
    /// Applies custom chrome only where a view is outside a standard system
    /// container, such as a floating sheet.
    func chromeMaterial(_ kind: ChromeSurfaceKind = .panel) -> some View {
        modifier(ChromeMaterialModifier(kind: kind))
    }
}
