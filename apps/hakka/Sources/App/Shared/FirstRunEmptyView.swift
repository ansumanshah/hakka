import AppKit
import SwiftUI

/// Artboard 6's first-run pitch. `LiveTrafficListView` shows this only while
/// `TrafficModel.hasEverReceivedTraffic` is still false — the moment traffic
/// has arrived at least once, a later cleared list falls back to the
/// generic `EmptyStateView` ("Waiting for traffic") instead. This is a
/// one-time onboarding moment, not a standing empty state.
struct FirstRunEmptyView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.openURL) private var openURL
    @State private var didCopySnippet = false

    private static let docsURL = URL(string: "https://hakka.noodleapps.com")!

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            FirstRunFlowDiagram()
            Text("No proxy. No certificate to trust.")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text(
                """
                The SDK ships inside your app and streams requests straight to \
                this window over your LAN. Nothing intercepts your traffic, and \
                nothing needs installing on this machine.
                """,
            )
            .font(.callout)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 400)
            actions
            Text(listeningCaption)
                .font(.caption.monospaced())
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(Spacing.xxxl)
        .chromeMaterial(.panel)
    }

    private var actions: some View {
        HStack(spacing: Spacing.md) {
            Button(action: copySnippet) {
                Label(
                    didCopySnippet ? "Copied" : "Copy setup snippet",
                    systemImage: didCopySnippet ? "checkmark" : "doc.on.doc",
                )
            }
            .accessibilityLabel("Copy setup snippet")
            .accessibilityHint("Copies the React Native install and start command to the clipboard.")

            Button("Open docs") {
                openURL(Self.docsURL)
            }
            .accessibilityHint("Opens the Hakka documentation site.")
        }
    }

    private func copySnippet() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(SetupSnippet.text, forType: .string)
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
        guard model.traffic.isRunning, let port = model.traffic.boundPort else {
            return "Starting the bridge…"
        }
        return "Listening on port \(port) · Bonjour hakka._tcp"
    }
}
