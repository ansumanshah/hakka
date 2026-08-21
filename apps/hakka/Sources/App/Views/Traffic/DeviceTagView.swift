import SwiftUI

/// Compact, non-interactive badge naming which connected device a row came
/// from. Steel (info) tint — device identity isn't a severity signal, so it
/// stays out of the chili/turmeric/jade vocabulary those tokens carry
/// elsewhere. Pill radius per `DESIGN.md`'s "non-interactive badges/tags"
/// rule; full text lives in the accessibility label and in
/// `DetailOverviewSection`, which is not this space-constrained.
struct DeviceTagView: View {
    let label: String

    var body: some View {
        Text(Self.compact(label))
            .font(.caption2.weight(.semibold))
            .foregroundStyle(ThemeTokens.Status.info)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(ThemeTokens.Status.info.opacity(0.1))
            .clipShape(Capsule())
            .accessibilityLabel(label)
    }

    /// "Device 3" → "D3" — the only shape `BridgeDeviceLabeler` produces
    /// today. A label of any other shape (a future identity source) is
    /// shown verbatim rather than mangled by an assumption that no longer
    /// holds.
    private static func compact(_ label: String) -> String {
        let prefix = "Device "
        guard label.hasPrefix(prefix) else { return label }
        return "D" + label.dropFirst(prefix.count)
    }
}
