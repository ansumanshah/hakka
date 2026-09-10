import AppKit
import SwiftUI

struct ProxySetupSection: View {
    let proxy: ProxyCaptureModel
    @State private var target = ProxySetupGuide.Target.mac

    var body: some View {
        Section("Setup guide") {
            Picker("Capture from", selection: $target) {
                ForEach(ProxySetupGuide.Target.allCases) { target in
                    Text(target.rawValue).tag(target)
                }
            }
            Label(proxy.state == .running ? "Proxy is listening" : "Start capture to open the proxy", systemImage: proxy.state == .running ? "checkmark.circle.fill" : "1.circle")
            if target != .mac && !proxy.allowLAN {
                Label("Enable local network access before starting capture.", systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.orange)
            }
            Text(target.instructions).font(.callout).foregroundStyle(.secondary)
            Label(proxy.capturedCount > 0 ? "\(proxy.capturedCount) requests captured in this session" : "Send a request, then inspect it in Live Traffic", systemImage: proxy.capturedCount > 0 ? "checkmark.circle.fill" : "2.circle")
            if proxy.state == .running {
                HStack {
                    Button(proxy.isTestingConnection ? "Testing…" : "Test This Mac’s Connection") {
                        Task { await proxy.testConnection() }
                    }.disabled(proxy.isTestingConnection)
                    if proxy.isTestingConnection {
                        ProgressView().controlSize(.small)
                    }
                }
                Text("Sends one request to example.com through this proxy. Device trust and routing must be tested on the device.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let result = proxy.connectionTest {
                Label(result.message, systemImage: result.succeeded ? "checkmark.circle.fill" : "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(result.succeeded ? Color.green : Color.orange)
            }
            if target == .mac, let command = ProxySetupGuide.testCommand(port: proxy.port, certificatePath: proxy.certificatePath) {
                Text(command).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                Button("Copy Test Command") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(command, forType: .string)
                }.disabled(proxy.state != .running)
                Text(proxy.certificatePath == nil ? "This checks HTTP routing. Once the public certificate is available, the command checks HTTPS too." : "The command trusts Hakka’s public certificate for this request only. A successful response checks this Mac’s route; test your phone separately.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }
}
