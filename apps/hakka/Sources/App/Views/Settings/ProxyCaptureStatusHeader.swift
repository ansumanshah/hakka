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
                Text(title)
                    .font(.callout.weight(.semibold))
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
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
                Button(action: showConnection) {
                    CaptureActionLabel("View Traffic")
                }
                .captureGlassButtonStyle()
                .controlSize(.regular)
                Button {
                    Task { _ = await proxy.stop() }
                } label: {
                    CaptureActionLabel("Stop", systemImage: "stop.fill")
                }
                .captureGlassButtonStyle()
                .controlSize(.regular)
                .disabled(proxy.state == .stopping)
                .accessibilityIdentifier("proxy.stop")
            } else if !bridgeRunning {
                Button(action: showConnection) {
                    CaptureActionLabel("Show Connection")
                }
                .captureGlassButtonStyle()
                .controlSize(.regular)
            } else {
                Button {
                    proxy.start(bridgePort: bridgePort ?? 8989)
                } label: {
                    CaptureActionLabel("Start", systemImage: "play.fill", isProminent: true)
                }
                .captureGlassButtonStyle(prominent: true)
                .controlSize(.regular)
                .disabled(!bridgeRunning)
                .accessibilityIdentifier("proxy.start")
            }
        }
        .padding(.horizontal, Layout.gutter)
        .padding(.vertical, Spacing.lg)
        .frame(minHeight: ControlHeight.bar + Spacing.md)
        .accessibilityElement(children: .contain)
    }

    private var title: String {
        switch proxy.state {
        case .stopped: "Capture stopped"
        case .starting: "Starting capture…"
        case .running: "Capturing traffic"
        case .stopping: "Stopping capture…"
        case .failed: "Capture failed"
        }
    }

    private var detail: String {
        if proxy.state == .failed { return proxy.message }
        if proxy.state == .stopped, bridgeRunning { return "Start capture, then connect an app or device." }
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
