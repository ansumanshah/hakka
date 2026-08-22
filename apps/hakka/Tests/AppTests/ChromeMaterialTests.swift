import Foundation
import Testing
@testable import HakkaApp

/// `ChromeMaterial.usesGlass(for:)` is the pure decision function the
/// Artboard 8 chrome-material `#available(macOS 26.0, *)` gate defers to —
/// this exercises both branches directly (see `ChromeMaterial.swift`'s doc
/// comment) rather than depending on which macOS this suite happens to run
/// on.
@Suite("ChromeMaterial availability")
struct ChromeMaterialTests {
    private func version(_ major: Int, _ minor: Int = 0, _ patch: Int = 0) -> OperatingSystemVersion {
        OperatingSystemVersion(majorVersion: major, minorVersion: minor, patchVersion: patch)
    }

    @Test func macOS26AndNewerUseGlass() {
        #expect(ChromeMaterial.usesGlass(for: version(26)))
        #expect(ChromeMaterial.usesGlass(for: version(27)))
        #expect(ChromeMaterial.usesGlass(for: version(26, 5)))
    }

    @Test func macOS15Through25FallBackToMaterials() {
        #expect(!ChromeMaterial.usesGlass(for: version(15)))
        #expect(!ChromeMaterial.usesGlass(for: version(25, 6)))
        #expect(!ChromeMaterial.usesGlass(for: version(25)))
    }

    /// The runtime property must agree with the pure function fed this
    /// process's own version — a divergence here would mean the two paths
    /// (view modifier's `#available` vs. this helper) disagree about where
    /// the line is.
    @Test func isGlassAvailableMatchesTheCurrentProcessVersion() {
        let current = ProcessInfo.processInfo.operatingSystemVersion
        #expect(ChromeMaterial.isGlassAvailable == ChromeMaterial.usesGlass(for: current))
    }
}
