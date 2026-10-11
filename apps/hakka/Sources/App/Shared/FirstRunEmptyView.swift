import AppKit
import SwiftUI

/// Setup guidance shown until the desktop receives its first capture.
struct FirstRunEmptyView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    @State private var didCopySnippet = false
    @State private var selectedTarget = SetupSnippet.Target.web

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xxl) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Label("Connect your app", systemImage: "network")
                        .font(.title2.weight(.semibold))
                        .accessibilityAddTraits(.isHeader)
                    Text("Capture development traffic locally, then select a request to inspect its headers, body, and timing.")
                        .font(.callout)
                        .foregroundStyle(ThemeTokens.Palette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Button("Capture with a Proxy", systemImage: "network") { app.select(.proxy) }
                        .buttonStyle(.borderedProminent)
                    Text("Connect iOS Simulator or an iPhone through Hakka’s proxy without an app SDK. Setup guides explain routing and HTTPS trust. Apps that bypass proxies or pin certificates may not be captured.")
                        .font(.callout)
                        .foregroundStyle(ThemeTokens.Palette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                setupPicker
                actions
                Label("Keep Hakka open while you run your app. Captured requests appear here automatically.", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.callout)
                    .foregroundStyle(ThemeTokens.Palette.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 540, alignment: .leading) // ui-token-check-ignore: setup reading measure
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxxl)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .chromeMaterial(.panel)
        .onChange(of: selectedTarget) { _, _ in didCopySnippet = false }
    }

    private var actions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Spacing.md) {
                copySetupButton
                docsButton
            }
            VStack(alignment: .leading, spacing: Spacing.md) {
                copySetupButton
                docsButton
            }
        }
        .controlSize(.regular)
    }

    private var copySetupButton: some View {
        Button(action: copySnippet) {
            Label(
                didCopySnippet ? "Copied" : "Copy \(selectedTarget.title) setup",
                systemImage: didCopySnippet ? "checkmark" : "doc.on.doc"
            )
        }
        .buttonStyle(.borderedProminent)
        .accessibilityHint("Copies the development-only setup for the local desktop bridge.")
    }

    private var docsButton: some View {
        Button("Open setup guide") { openURL(selectedTarget.docsURL) }
            .accessibilityHint("Opens the \(selectedTarget.title) setup guide.")
    }

    private var setupPicker: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Picker("Capture from", selection: $selectedTarget) {
                ForEach(SetupSnippet.Target.allCases) { target in
                    Text(target.title).tag(target)
                }
            }
            .pickerStyle(.menu)
            .controlSize(.regular)
            .accessibilityHint("Selects the setup snippet to copy.")

            ScrollView(.horizontal, showsIndicators: true) {
                Text(SetupSnippet.text(for: selectedTarget))
                    .font(.callout.monospaced())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Spacing.md)
            }
            .background(ThemeTokens.Palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Radius.md))
            .overlay(RoundedRectangle(cornerRadius: Radius.md).strokeBorder(ThemeTokens.Palette.border))
        }
        .frame(maxWidth: 540) // ui-token-check-ignore: setup reading measure
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

}
