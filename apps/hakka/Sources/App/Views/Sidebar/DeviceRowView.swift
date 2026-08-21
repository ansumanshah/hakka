import SwiftUI

/// One row in the sidebar's Devices section — the hub-with-many-peers
/// architecture made visible. Deliberately not part of the `List`'s typed
/// `SidebarSelection` (see `SidebarView`'s Devices section for why): tapping
/// scopes the traffic list via `TrafficModel.selectDevice` instead of
/// claiming a selection state of its own.
struct DeviceRowView: View {
    let summary: DeviceSummary
    let isScoped: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                connectionDot
                Text(summary.device.displayName)
                    .lineLimit(1)
                Spacer()
                if summary.errorCount > 0 {
                    Text("\(summary.errorCount)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(ThemeTokens.Status.error)
                }
                Text("\(summary.requestCount)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(isScoped ? Color.accentColor : .primary)
        .accessibilityLabel(accessibilityLabel)
    }

    private var connectionDot: some View {
        Circle()
            .fill(summary.device.isConnected ? ThemeTokens.Status.success : ThemeTokens.Status.pending)
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }

    private var accessibilityLabel: String {
        let state = summary.device.isConnected ? "connected" : "disconnected"
        return "\(summary.device.displayName), \(state), \(summary.requestCount) requests, \(summary.errorCount) errors"
    }
}
