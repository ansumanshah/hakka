import SwiftUI

/// Explicit target selection precedes all Simulator trust and routing changes.
struct SimulatorCaptureSetupView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var setup = app.simulatorSetup
        VStack(alignment: .leading, spacing: Spacing.lg) {
            WorkspaceHeaderView(title: "Set Up & Capture", subtitle: "Capture HTTPS from an iPhone Simulator")
            HStack(spacing: Spacing.sm) {
                Picker("Simulator", selection: $setup.selectedTargetID) {
                    Text("Choose a Simulator").tag(String?.none)
                    ForEach(setup.targets) { target in
                        Text("\(target.name) · \(target.state)").tag(Optional(target.id))
                    }
                }
                .disabled(setup.isSettingUp)
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await setup.refreshTargets() } }
                    .labelStyle(.iconOnly)
                    .disabled(setup.isSettingUp || setup.isRefreshingTargets)
            }
            Text("Setup routes this Mac through Hakka, boots your selected Simulator, installs Hakka’s public certificate there, and opens a test page in Safari. Stop Capture restores the previous Mac proxy settings. The Simulator certificate remains until you remove it or erase that Simulator.")
                .font(.callout).foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            VStack(alignment: .leading, spacing: Spacing.md) {
                check("Capture engine", state: setup.engine)
                check("Mac proxy routing", state: setup.routing)
                check("Simulator certificate", state: setup.certificate)
                check("Simulator HTTPS response", state: setup.https)
                check("Delivered to Live Traffic", state: setup.delivery)
            }
            Text(setup.message).font(.callout).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if let fingerprint = setup.caFingerprint {
                Text("CA SHA-256: \(fingerprint)").font(.caption.monospaced())
                    .foregroundStyle(.secondary).textSelection(.enabled)
            }
            Divider()
            HStack(spacing: Spacing.md) {
                Button("Manual / Physical Device Setup") { dismiss(); app.select(.proxy) }
                Spacer(minLength: Spacing.sm)
                if setup.isSettingUp {
                    Button("Cancel") { setup.cancel() }
                } else {
                    Button("Done") { dismiss() }
                        .keyboardShortcut(.cancelAction)
                    Button("Set Up & Capture", systemImage: "play.fill") {
                        Task { await setup.setUp(proxy: app.proxy, traffic: app.traffic) }
                    }
                    .captureGlassButtonStyle(prominent: true)
                    .disabled(setup.selectedTargetID == nil || !app.traffic.isRunning)
                }
            }
            .controlSize(.regular)
        }
        .padding(Spacing.xl)
        .frame(width: 600) // ui-token-check-ignore: guided setup sheet width
        .interactiveDismissDisabled(setup.isSettingUp)
        .task { await setup.refreshTargets() }
    }

    private func check(_ title: String, state: SimulatorCaptureSetup.CheckState) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: symbol(state)).foregroundStyle(color(state))
            Text(title)
            Spacer(minLength: Spacing.sm)
            Text(label(state)).foregroundStyle(.secondary)
        }
        .font(.callout)
        .accessibilityElement(children: .combine)
    }

    private func symbol(_ state: SimulatorCaptureSetup.CheckState) -> String {
        switch state {
        case .pending: "circle"
        case .working: "clock"
        case .complete: "checkmark.circle.fill"
        case .failed: "exclamationmark.circle.fill"
        }
    }

    private func label(_ state: SimulatorCaptureSetup.CheckState) -> String {
        switch state {
        case .pending: "Not checked"
        case .working: "Checking…"
        case .complete: "Verified"
        case .failed: "Needs attention"
        }
    }

    private func color(_ state: SimulatorCaptureSetup.CheckState) -> Color {
        switch state {
        case .pending, .working: .secondary
        case .complete: ThemeTokens.Status.success
        case .failed: ThemeTokens.Status.error
        }
    }
}
