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
    @State private var showingAddRule = false

    private var mocks: [RuleEntry] {
        model.rules.entries.filter { RuleEntryDisplay($0).kind == .mock }
    }

    private var breakpoints: [RuleEntry] {
        model.rules.entries.filter { RuleEntryDisplay($0).kind == .breakpoint }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    RulesSection(title: "Mocks", isEmpty: mocks.isEmpty, empty: "No mocks — promote one from a captured request's Mock action, or Add rule above.") {
                        ForEach(mocks) { entry in
                            RuleRowView(entry: entry, rules: model.rules)
                        }
                    }
                    RulesSection(title: "Breakpoints", isEmpty: breakpoints.isEmpty, empty: "No breakpoints — add one from a captured request, or Add rule above.") {
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
        .sheet(isPresented: $showingAddRule) {
            AddRuleSheet()
        }
    }

    /// Title, a live device count ("Pushed to N devices" — connected devices
    /// only; a disconnected one is still in `model.traffic.devices` per
    /// `ConnectedDevice`'s doc comment, and counting it would overstate who
    /// actually has these rules), and the primary "+ Add rule" action.
    private var header: some View {
        HStack(spacing: Spacing.md) {
            Text("Rules")
                .font(.headline)
            Spacer()
            Text(pushedText)
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                showingAddRule = true
            } label: {
                Label("Add rule", systemImage: "plus")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        .padding(Spacing.lg)
    }

    private var pushedText: String {
        let count = model.traffic.devices.filter(\.isConnected).count
        return "Pushed to \(count) device\(count == 1 ? "" : "s")"
    }

    private var throttleSection: some View {
        RulesSection(title: "Network Conditions", isEmpty: false, empty: nil) {
            HStack(spacing: Spacing.ml) {
                ThrottlePillRow(selection: throttleBinding)
                Text(Fmt.throttleReadout(model.rules.throttleProfile))
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                Spacer()
            }
            Text("Applies to every connected device until set back to Off.")
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
