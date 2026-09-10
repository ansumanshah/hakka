import SwiftUI

/// Compact operational summary that keeps capture state and its primary action
/// visible while the setup pages scroll independently below it.
struct ProxyCaptureStatusHeader: View {
    let proxy: ProxyCaptureModel
    let bridgePort: UInt16?
    let bridgeRunning: Bool
    let bridgeError: String?
    let showConnection: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: Spacing.md) {
            Image(systemName: symbol)
                .foregroundStyle(symbolColor)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(proxy.message)
                    .font(.callout.weight(.semibold))
                    .lineLimit(1)
                    .textSelection(.enabled)
                    .help(proxy.message)
                    .accessibilityIdentifier("proxy.status")
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .help(detail)
            }

            Spacer(minLength: Spacing.sm)

            if proxy.isActive {
                Button("View Traffic", action: showConnection)
                    .controlSize(.small)
                Button("Stop", systemImage: "stop.fill") {
                    Task { _ = await proxy.stop() }
                }
                .controlSize(.small)
                .disabled(proxy.state == .stopping)
                .accessibilityIdentifier("proxy.stop")
            } else if !bridgeRunning {
                Button("Show Connection", action: showConnection)
                    .controlSize(.small)
            } else {
                Button("Start", systemImage: "play.fill") {
                    proxy.start(bridgePort: bridgePort ?? 8989)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .disabled(!bridgeRunning)
                .accessibilityIdentifier("proxy.start")
            }
        }
        .padding(.horizontal, Layout.gutter)
        .frame(minHeight: ControlHeight.bar + Spacing.md)
        .accessibilityElement(children: .contain)
    }

    private var detail: String {
        if bridgeRunning {
            return proxy.capturedCount == 1 ? "1 captured request" : "\(proxy.capturedCount) captured requests"
        }
        return bridgeError ?? "Waiting for the desktop bridge"
    }

    private var symbol: String {
        switch proxy.state {
        case .running: "circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        case .starting, .stopping: "hourglass"
        case .stopped: "circle"
        }
    }

    private var symbolColor: Color {
        switch proxy.state {
        case .running: ThemeTokens.Status.success
        case .failed: ThemeTokens.Status.error
        case .starting, .stopping: ThemeTokens.Status.warning
        case .stopped: .secondary
        }
    }
}
