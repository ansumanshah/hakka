import AppKit
import SwiftUI

/// Setup guidance shown until the desktop receives its first capture.
struct FirstRunEmptyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var didCopySnippet = false
    @State private var selectedTarget = SetupSnippet.Target.web

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.lg) {
                Image(systemName: "network")
                    .font(.system(size: 32)) // ui-token-check-ignore: onboarding illustration
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("Connect your app")
                    .font(.headline)
                    .multilineTextAlignment(.center)
                Text(
                    """
                    Choose your runtime to send local development traffic to this window. \
                    Keep Hakka open while your app runs.
                    """
                )
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 400)
                setupPicker
                actions
                Text(listeningCaption)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .chromeMaterial(.panel)
        .onChange(of: selectedTarget) { _, _ in didCopySnippet = false }
    }

    private var actions: some View {
        HStack(spacing: Spacing.md) {
            Button(action: copySnippet) {
                Label(
                    didCopySnippet ? "Copied" : "Copy \(selectedTarget.title) setup",
                    systemImage: didCopySnippet ? "checkmark" : "doc.on.doc"
                )
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel("Copy \(selectedTarget.title) setup")
            .accessibilityHint("Copies the development-only setup for the local desktop bridge.")

            Button("Open docs") {
                openURL(selectedTarget.docsURL)
            }
            .accessibilityHint("Opens the \(selectedTarget.title) setup guide.")
        }
    }

    private var setupPicker: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Picker("Capture from", selection: $selectedTarget) {
                ForEach(SetupSnippet.Target.allCases) { target in
                    Text(target.title).tag(target)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityHint("Selects the setup snippet to copy.")

            ScrollView(.horizontal) {
                Text(SetupSnippet.text(for: selectedTarget))
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.md)
            }
            .background(.quaternary, in: RoundedRectangle(cornerRadius: Radius.md))
        }
        .frame(maxWidth: 540)
    }

    private func copySnippet() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(SetupSnippet.text(for: selectedTarget), forType: .string)
        didCopySnippet = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            didCopySnippet = false
        }
    }

    /// Real server state when available (Artboard 6's caption), rather than
    /// a hardcoded "8989" — a dev who rebinds the port via
    /// `BridgeServerOptions` should see their own port, not the default.
    private var listeningCaption: String {
        if let error = model.traffic.startupError {
            return error
        }
        guard model.traffic.isRunning, let port = model.traffic.boundPort, port != 0 else {
            return "Starting the bridge…"
        }
        return "Listening on port \(port) · Local connections"
    }
}
