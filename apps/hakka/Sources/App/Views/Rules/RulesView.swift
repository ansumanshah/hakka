import HakkaCommon
import HakkaCore
import SwiftUI

/// The Rules surface: Mocks, Breakpoints, and the device-global throttle —
/// the human half of the rules this app pushes to devices over the bridge.
/// Sectioned to mirror the mobile inspectors' rules structure; the sidebar's
/// Traffic section links here (a section entry, not a sixth top tab).
/// Observation is owned by the app root, not a `.task` here — the change
/// stream is single-consumer.
struct RulesView: View {
    @Environment(AppModel.self) private var model

    private var mocks: [RuleEntry] {
        model.rules.entries.filter { RuleEntryDisplay($0).kind == .mock }
    }

    private var breakpoints: [RuleEntry] {
        model.rules.entries.filter { RuleEntryDisplay($0).kind == .breakpoint }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                RulesSection(title: "Mocks", isEmpty: mocks.isEmpty, empty: "No mocks — promote one from a captured request's Mock action.") {
                    ForEach(mocks) { entry in
                        RuleRowView(entry: entry, rules: model.rules)
                    }
                }
                RulesSection(title: "Breakpoints", isEmpty: breakpoints.isEmpty, empty: "No breakpoints — add one from a captured request.") {
                    ForEach(breakpoints) { entry in
                        RuleRowView(entry: entry, rules: model.rules)
                    }
                }
                throttleSection
                if let note = model.rules.deliveryNote {
                    Text(note)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(Spacing.xl)
        }
    }

    private var throttleSection: some View {
        RulesSection(title: "Network Conditions", isEmpty: false, empty: nil) {
            Picker("Profile", selection: throttleBinding) {
                Text("None").tag(ThrottleProfile.none)
                Text("Fast 3G").tag(ThrottleProfile.fast3g)
                Text("Slow 3G").tag(ThrottleProfile.slow3g)
                Text("EDGE").tag(ThrottleProfile.edge)
                Text("Offline").tag(ThrottleProfile.offline)
            }
            .labelsHidden()
            Text("Applies to every connected device until set back to None.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var throttleBinding: Binding<ThrottleProfile> {
        Binding(
            get: { model.rules.throttleProfile },
            set: {
                model.rules.throttleProfile = $0
                model.rules.applyThrottle()
            }
        )
    }
}

/// One titled slice of the Rules surface; `empty` explains an absent list so
/// the surface never reads as broken.
private struct RulesSection<Content: View>: View {
    let title: String
    let isEmpty: Bool
    let empty: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            Text(title.uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if isEmpty, let empty {
                Text(empty)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                content
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}
