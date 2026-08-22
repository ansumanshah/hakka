import Foundation
import SwiftUI

/// Which chrome surface a view represents. Drives corner shape only — the
/// system material/glass fills whatever shape it is given.
enum ChromeSurfaceKind {
    /// Title/toolbar bars, sidebar background, sparse detail panes — no
    /// corner rounding, they fill an edge-to-edge region.
    case panel
    /// A floating sheet — rounded corners to match the window it presents
    /// over (Artboard 8's `.glass-sheet`).
    case sheet
}

/// Centralizes Artboard 8's chrome-material system behind one
/// `#available(macOS 26.0, *)` check, so every call site opts in with a
/// single `.chromeMaterial(_:)` modifier instead of re-deriving the gate.
/// macOS 26+ draws the real Liquid Glass (`glassEffect`, verified against
/// the macOS 26 SDK's `SwiftUICore.swiftinterface` — it lives in
/// `SwiftUICore`, re-exported through `SwiftUI`); macOS 15–25 falls back to
/// the Fallback artboard's standard materials. Same layout either side, only
/// the surface treatment swaps.
///
/// Chrome only: window title/toolbar, sidebar background, sparse/empty
/// panes, and sheets. Never behind the traffic rows or a pane holding real
/// captured data (JSON, response bodies, timing) — a dense body under
/// translucency is a legibility risk on an instrument stared at for hours.
/// See the artboard's "where glass stays off" note.
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

    /// Style for the window's native toolbar. Real Liquid Glass already
    /// renders itself there on macOS 26+ with no manual work, so this stays
    /// `.clear` rather than fighting the system chrome; macOS 15–25 gets the
    /// same `.bar` material used for every other panel surface.
    static var toolbarStyle: AnyShapeStyle {
        if #available(macOS 26.0, *) {
            AnyShapeStyle(Color.clear)
        } else {
            AnyShapeStyle(Material.bar)
        }
    }

    fileprivate static func fallbackMaterial(for kind: ChromeSurfaceKind) -> Material {
        switch kind {
        case .panel: .bar
        case .sheet: .regularMaterial
        }
    }

    fileprivate static func shape(for kind: ChromeSurfaceKind) -> AnyShape {
        switch kind {
        case .panel: AnyShape(Rectangle())
        case .sheet: AnyShape(RoundedRectangle(cornerRadius: Radius.lg, style: .continuous))
        }
    }
}

private struct ChromeMaterialModifier: ViewModifier {
    var kind: ChromeSurfaceKind

    func body(content: Content) -> some View {
        if #available(macOS 26.0, *) {
            content.glassEffect(.regular, in: ChromeMaterial.shape(for: kind))
        } else {
            content.background(ChromeMaterial.fallbackMaterial(for: kind), in: ChromeMaterial.shape(for: kind))
        }
    }
}

extension View {
    /// Opts this view into the Artboard 8 chrome-material system. See
    /// `ChromeMaterial`'s doc comment for scope rules — chrome surfaces
    /// only, never a pane with real captured data behind it.
    func chromeMaterial(_ kind: ChromeSurfaceKind = .panel) -> some View {
        modifier(ChromeMaterialModifier(kind: kind))
    }
}
