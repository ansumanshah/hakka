import AppKit
import SwiftUI

struct ProxyRuntimeSetupSection: View {
    let port: Int
    let certificatePath: String?

    @State private var runtime = ProxyRuntime.pythonRequests
    @State private var didCopy = false

    var body: some View {
        if let guide = ProxyRuntimeSetupGuide(port: port, certificatePath: certificatePath) {
            Section("Test a developer runtime") {
                Picker("Runtime", selection: $runtime) {
                    ForEach(ProxyRuntime.allCases) { runtime in Text(runtime.title).tag(runtime) }
                }
                Text(runtime.prerequisite).font(.callout).foregroundStyle(.secondary)
                Text("This command trusts Hakka’s public CA and forces this test request through the proxy. It only configures the spawned process; it does not change shell profiles, system proxy settings, or TLS verification.")
                    .font(.callout).foregroundStyle(.secondary)
                Text(guide.command(for: runtime))
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
                Button(didCopy ? "Copied" : "Copy \(runtime.title) Command") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(guide.command(for: runtime), forType: .string)
                    didCopy = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        didCopy = false
                    }
                }
            }
            .onChange(of: runtime) { _, _ in didCopy = false }
        }
    }
}
