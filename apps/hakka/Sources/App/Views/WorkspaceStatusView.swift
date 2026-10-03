import SwiftUI

/// A single toolbar entry owns environment and connection context.
struct WorkspaceStatusView: View {
    @Environment(AppModel.self) private var model
    @State private var showingContext = false
    let compact: Bool

    var body: some View {
        Button {
            showingContext.toggle()
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "network")
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(compact ? captureLabel : model.environment.selected?.name ?? "Local")
                        .font(.callout.weight(.medium))
                    if !compact {
                        HStack(spacing: Spacing.xs) {
                            Image(systemName: model.traffic.startupError != nil && model.proxy.state != .running
                                  ? "exclamationmark.triangle.fill" : "circle.fill")
                                .font(.caption2)
                                .foregroundStyle(captureTone)
                                .accessibilityHidden(true)
                            Text(captureLabel)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .help("\(captureLabel) · Environment and connections")
        .accessibilityLabel("Environment and connections: \(model.environment.selected?.name ?? "none"), \(captureLabel)")
        .popover(isPresented: $showingContext) {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("Environment").font(.headline)
                EnvironmentPickerView()
                Divider()
                LabeledContent("Capture", value: captureLabel)
                LabeledContent("Devices", value: String(model.traffic.deviceSummaries.count))
                if let error = model.traffic.startupError {
                    Text(error).font(.caption).foregroundStyle(ThemeTokens.Status.error)
                }
                Button("Open Proxy") {
                    model.select(.proxy)
                    showingContext = false
                }
            }
            .padding(Layout.gutter)
            .frame(width: 300) // ui-token-check-ignore: connection popover width
        }
    }

    private var captureTone: Color {
        if model.proxy.state == .running { return ThemeTokens.Status.success }
        if model.traffic.startupError != nil { return ThemeTokens.Status.error }
        return model.traffic.isRunning ? ThemeTokens.Status.success : ThemeTokens.Status.pending
    }

    private var captureLabel: String {
        if model.proxy.state == .running { return "Proxy \(model.proxy.port)" }
        if model.traffic.startupError != nil { return "Bridge unavailable" }
        if model.traffic.isRunning { return "Bridge ready" }
        return "Bridge offline"
    }
}
