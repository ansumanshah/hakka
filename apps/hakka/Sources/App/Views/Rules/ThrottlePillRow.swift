import HakkaCommon
import SwiftUI

/// The five shipped throttle presets as a flat segmented pill row — the
/// design draws four illustrative options (Off/3G/Edge/Custom), but the
/// engine only ships these five real presets and has no "Custom" UI
/// anywhere else in the app, so the row keeps what is actually true rather
/// than matching the mockup literally. Same visual formula as
/// `LogsFilterBar.levelChip`/`StorageFilterBar`'s filter chips — this app's
/// own flat-pill idiom — rather than gen.py's solid-fill styling, so the
/// three segmented rows in this app read as one family.
struct ThrottlePillRow: View {
    @Binding var selection: ThrottleProfile

    private static let profiles: [(ThrottleProfile, String)] = [
        (.none, "Off"),
        (.fast3g, "Fast 3G"),
        (.slow3g, "Slow 3G"),
        (.edge, "EDGE"),
        (.offline, "Offline"),
    ]

    var body: some View {
        HStack(spacing: Spacing.xxs) {
            ForEach(Self.profiles, id: \.0) { profile, label in
                pill(profile, label: label)
            }
        }
        .padding(Spacing.xxs)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: Radius.md))
    }

    private func pill(_ profile: ThrottleProfile, label: String) -> some View {
        let isActive = selection == profile
        return Button {
            selection = profile
        } label: {
            Text(label)
                .font(.caption2.weight(.semibold))
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, Spacing.xs)
                .background(isActive ? Color.accentColor.opacity(0.2) : Color.clear, in: RoundedRectangle(cornerRadius: Radius.sm))
                .foregroundStyle(isActive ? Color.accentColor : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) network profile")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
