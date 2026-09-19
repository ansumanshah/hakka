import HakkaCommon
import SwiftUI

/// Native selection for the network profiles supported by the capture engine.
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
        Picker("Network profile", selection: $selection) {
            ForEach(Self.profiles, id: \.0) { profile, label in
                Text(label).tag(profile)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlSize(.regular)
        .fixedSize()
        .accessibilityLabel("Network profile")
    }
}
