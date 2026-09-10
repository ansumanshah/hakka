import SwiftUI

/// Current proxy readiness and session context, without changing routing or trust.
struct ProxyOverviewView: View {
    let proxy: ProxyCaptureModel
    let bridgeRunning: Bool
    let configure: () -> Void

    var body: some View {
        Section("Capture") {
            LabeledContent("Status", value: proxy.message)
            LabeledContent("Desktop bridge", value: bridgeRunning ? "Ready" : "Offline")
            LabeledContent("Listen address", value: "127.0.0.1:\(proxy.port)")
                .textSelection(.enabled)
            LabeledContent("Captured requests", value: String(proxy.capturedCount))
        }
        Section("Connections") {
            LabeledContent("Local network", value: proxy.allowLAN ? "Allowed" : "This Mac only")
            LabeledContent("Automatic Mac routing", value: proxy.routeThisMac ? "Enabled for capture" : "Off")
            LabeledContent("HTTPS certificate", value: proxy.certificatePath == nil ? "Not available yet" : "Available for device setup")
            if proxy.isSystemProxyRoutingRecoveryPending {
                Label("Previous proxy settings need recovery. Open Connections to restore them.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(ThemeTokens.Status.warning)
            }
            Button("Configure Connections", action: configure)
        }
        Section("Workflow") {
            Text("Start capture, connect an app, then inspect its requests in Live Traffic. Save a captured request to your collection to edit, send, and test it again.")
                .foregroundStyle(.secondary)
        }
    }
}
