import SwiftUI

/// Capture controls stay visible beside the traffic they produce.
struct TrafficCaptureStrip: View {
    @Environment(AppModel.self) private var app
    @State private var presentsSetup = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.md) {
                    title
                    Spacer(minLength: Spacing.sm)
                    captureActions
                }
                VStack(alignment: .leading, spacing: Spacing.md) {
                    title
                    captureActions
                }
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Spacing.md) { readiness }
                VStack(alignment: .leading, spacing: Spacing.xxs) { readiness }
            }
            .font(.caption)
            if app.proxy.state == .failed || app.proxy.isSystemProxyRoutingRecoveryPending {
                Text(app.proxy.message)
                    .font(.caption)
                    .foregroundStyle(ThemeTokens.Status.error)
                    .textSelection(.enabled)
            }
        }
        .padding(.horizontal, Layout.gutter)
        .padding(.top, Spacing.lg)
        .padding(.bottom, Spacing.sm)
        .accessibilityElement(children: .contain)
        .sheet(isPresented: $presentsSetup) { SimulatorCaptureSetupView() }
    }

    private var title: some View {
        WorkspaceHeaderView(title: "Live Traffic", subtitle: "\(app.traffic.requests.count.formatted()) \(app.traffic.requests.count == 1 ? "request" : "requests")")
    }

    private var captureActions: some View {
        CaptureGlassControls {
            HStack(spacing: Spacing.sm) {
                if app.proxy.isActive {
                    Button {
                        Task { _ = await app.proxy.stop() }
                    } label: {
                        CaptureActionLabel(app.proxy.state == .stopping ? "Stopping…" : "Stop Capture", systemImage: "stop.fill")
                    }
                    .captureGlassButtonStyle()
                    .disabled(app.proxy.state == .stopping)
                    .accessibilityIdentifier("traffic.capture.stop")
                } else {
                    Button {
                        if let port = app.traffic.boundPort {
                            app.proxy.start(bridgePort: port)
                        }
                    } label: {
                        CaptureActionLabel("Start Capture", systemImage: "play.fill", isProminent: true)
                    }
                    .captureGlassButtonStyle(prominent: true)
                    .disabled(!app.traffic.isRunning || app.traffic.boundPort == nil)
                    .accessibilityIdentifier("traffic.capture.start")
                }
                Button { presentsSetup = true } label: {
                    CaptureActionLabel("Set Up & Capture", systemImage: "iphone")
                }
                .captureGlassButtonStyle()
                .accessibilityIdentifier("traffic.capture.setup")
            }
        }
        .controlSize(.regular)
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder private var readiness: some View {
        Label("Engine \(String(describing: app.proxy.state))", systemImage: "circle.fill")
            .foregroundStyle(app.proxy.state == .running ? ThemeTokens.Status.success : .secondary)
        Label(app.traffic.isRunning ? "Bridge listening" : "Bridge offline", systemImage: "circle.fill")
            .foregroundStyle(app.traffic.isRunning ? ThemeTokens.Status.success : .secondary)
        Label(app.simulatorSetup.https == .complete && app.simulatorSetup.delivery == .complete ? "Simulator HTTPS verified" : "Device HTTPS unverified", systemImage: "circle.fill")
            .foregroundStyle(app.simulatorSetup.https == .complete && app.simulatorSetup.delivery == .complete ? ThemeTokens.Status.success : ThemeTokens.Status.warning)
            .help("Verified means a new decrypted HTTPS response from the selected Simulator reached Live Traffic. Other devices require separate verification.")
    }
}
