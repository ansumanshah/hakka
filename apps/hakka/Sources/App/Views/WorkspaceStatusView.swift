import SwiftUI

/// A single toolbar entry owns environment and connection context.
struct WorkspaceStatusView: View {
    @Environment(AppModel.self) private var model
    @State private var showingContext = false
    let compact: Bool
    let onEditEnvironment: () -> Void

    var body: some View {
        Button {
            showingContext.toggle()
        } label: {
            HStack(spacing: Spacing.sm) {
                Image(systemName: "network")
                    .imageScale(.small)
                    .accessibilityHidden(true)
                if !compact {
                    Text(model.environment.selected?.name ?? "Local")
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(model.environment.selected?.name ?? "Local")
                }
                Circle()
                    .fill(captureTone)
                    .frame(width: Spacing.sm, height: Spacing.sm)
                    .accessibilityHidden(true)
                Text(captureLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .help("\(captureLabel) · Environment and connections")
        .accessibilityLabel("Environment and connections: \(model.environment.selected?.name ?? "none"), \(captureLabel)")
        .popover(isPresented: $showingContext) {
            VStack(alignment: .leading, spacing: Spacing.lg) {
                Text("Environment").font(.headline)
                EnvironmentPickerView(onEdit: {
                    showingContext = false
                    onEditEnvironment()
                })
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
