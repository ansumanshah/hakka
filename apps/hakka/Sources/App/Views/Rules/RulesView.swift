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
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    RulesSection(title: "Mocks", isEmpty: mocks.isEmpty, empty: "Return a saved response without contacting the server. Add a rule or choose Mock on a captured request.") {
                        ForEach(mocks) { entry in
                            RuleRowView(entry: entry, rules: model.rules)
                        }
                    }
                    RulesSection(title: "Breakpoints", isEmpty: breakpoints.isEmpty, empty: "Pause a matching request before it continues. Add a rule to choose which requests to pause.") {
                        ForEach(breakpoints) { entry in
                            RuleRowView(entry: entry, rules: model.rules)
                        }
                    }
                    throttleSection
                    if let note = model.rules.deliveryNote {
                        Text(note)
                            .font(.callout)
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
            .controlSize(.regular)
        }
        .padding(.horizontal, Layout.gutter)
        .padding(.vertical, Spacing.md)
    }

    private var pushedText: String {
        let count = model.traffic.devices.filter(\.isConnected).count
        return count == 0 ? "No connected devices" : "Applied to \(count) device\(count == 1 ? "" : "s")"
    }

    private var throttleSection: some View {
        RulesSection(title: "Network Conditions", isEmpty: false, empty: nil) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                ThrottlePillRow(selection: throttleBinding)
                Text(Fmt.throttleReadout(model.rules.throttleProfile))
                    .font(.callout.monospaced())
                    .foregroundStyle(.secondary)
            }
            Text("Applies to every connected device until set back to Off.")
                .font(.callout)
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
            Text(title)
                .font(.headline)
                .foregroundStyle(.primary)
            if isEmpty, let empty {
                Text(empty)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                content
            }
        }
        .padding(Layout.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: Radius.md))
        .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(Color(nsColor: .separatorColor).opacity(0.5)))
    }
}
