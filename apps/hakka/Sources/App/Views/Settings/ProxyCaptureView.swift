import AppKit
import SwiftUI

struct ProxyCaptureView: View {
    @Environment(AppModel.self) private var app
    @State private var addresses = ProxyDeviceAddress.activeAddresses()

    var body: some View {
        @Bindable var proxy = app.proxy
        Form {
            Section("Capture") {
                LabeledContent("Status", value: proxy.message)
                    .accessibilityIdentifier("proxy.status")
                TextField("Port", value: $proxy.port, format: .number.grouping(.never))
                    .disabled(proxy.isActive)
                Toggle("Allow devices on the local network", isOn: $proxy.allowLAN)
                    .disabled(proxy.isActive)
                Text("Configure your app or phone to use this Mac’s address and proxy port. Captured requests appear in Live Traffic.")
                    .font(.callout).foregroundStyle(.secondary)
                HStack {
                    Button("Start Capture") { proxy.start(bridgePort: app.traffic.boundPort ?? 8989) }
                        .disabled(proxy.isActive || !app.traffic.isRunning)
                        .accessibilityIdentifier("proxy.start")
                    Button("Stop Capture") { proxy.stop() }
                        .disabled(!proxy.isActive || proxy.state == .stopping)
                        .accessibilityIdentifier("proxy.stop")
                    Spacer()
                    Text("\(proxy.capturedCount) requests").monospacedDigit().foregroundStyle(.secondary)
                }
            }
            Section("Connect an app or device") {
                LabeledContent("This Mac", value: "127.0.0.1:\(proxy.port)")
                    .textSelection(.enabled)
                if proxy.allowLAN {
                    ForEach(addresses, id: \.self) { address in
                        LabeledContent("Device proxy", value: "\(address):\(proxy.port)")
                            .textSelection(.enabled)
                    }
                    if addresses.isEmpty { Text("Connect this Mac to Wi-Fi or Ethernet to show its address.").foregroundStyle(.secondary) }
                    Text("On your phone, open the connected Wi-Fi network’s proxy settings. Choose Manual, then enter one of the addresses above and port \(proxy.port).")
                        .font(.callout).foregroundStyle(.secondary)
                }
                HStack {
                    Button("Refresh Addresses") { addresses = ProxyDeviceAddress.activeAddresses() }
                    Button("Open Network Settings") {
                        if let url = URL(string: "x-apple.systempreferences:com.apple.Network-Settings.extension") { NSWorkspace.shared.open(url) }
                    }
                }
            }
            Section("HTTPS setup") {
                Text("Start capture, set the device’s proxy, then visit mitm.it through it to trust the public certificate. Trust is configured on the test device; Hakka does not change system trust.")
                    .font(.callout)
                HStack {
                    Button("Copy Setup Address") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString("http://mitm.it", forType: .string)
                    }
                    Button("Show Public Certificate") {
                        if let path = proxy.certificatePath { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) }
                    }.disabled(proxy.certificatePath == nil)
                }
            }
            Section("Mappings") {
                Text("Mappings apply when capture starts. Stop capture before editing.")
                    .font(.callout).foregroundStyle(.secondary)
                ProxyMappingsEditor(mappings: $proxy.mappings)
                    .disabled(proxy.isActive)
            }
            Section("Agents") {
                Toggle("Allow agents to start and stop this proxy", isOn: $proxy.allowAgentControl)
                Text("Enable the MCP server in Settings to expose proxy_status, proxy_start, and proxy_stop. Agents use the configuration shown here; this permission resets when Hakka quits.")
                    .font(.callout).foregroundStyle(.secondary)
            }
            DisclosureGroup("Runtime configuration") {
                HStack {
                    TextField("Hakka CLI", text: $proxy.cliPath)
                    Button("Choose CLI…") { chooseFile { proxy.cliPath = $0 } }
                }
                HStack {
                    TextField("Node executable", text: $proxy.nodePath)
                    Button("Choose Node…") { chooseFile { proxy.nodePath = $0 } }
                }
                Text("Use an installed hakka executable or built cli.mjs. Install mitmproxy separately. These paths are passed directly to the process, without a shell.")
                    .font(.caption).foregroundStyle(.secondary)
            }.disabled(proxy.isActive)
        }
        .formStyle(.grouped)
        .frame(minWidth: 560, minHeight: 560) // ui-token-check-ignore: window chrome
        .navigationTitle("Proxy Capture")
    }

    private func chooseFile(_ select: (String) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url { select(url.path) }
    }
}

private struct ProxyMappingsEditor: View {
    @Binding var mappings: ProxyMappingFile

    var body: some View {
        ForEach($mappings.mapLocal) { $rule in
            VStack(alignment: .leading, spacing: Spacing.sm) {
                TextField("URL expression", text: $rule.match)
                HStack {
                    TextField("Local response file", text: $rule.file)
                    Button("Choose…") {
                        let panel = NSOpenPanel()
                        panel.canChooseDirectories = false
                        if panel.runModal() == .OK, let url = panel.url { rule.file = url.path }
                    }
                    Button("Remove", role: .destructive) { mappings.mapLocal.removeAll { $0.id == rule.id } }
                }
            }
        }
        ForEach($mappings.mapRemote) { $rule in
            VStack(alignment: .leading, spacing: Spacing.sm) {
                TextField("URL expression", text: $rule.match)
                HStack {
                    TextField("Replacement URL", text: $rule.replace)
                    Button("Remove", role: .destructive) { mappings.mapRemote.removeAll { $0.id == rule.id } }
                }
            }
        }
        HStack {
            Button("Add Local Mapping") { mappings.mapLocal.append(ProxyLocalMapping()) }
            Button("Add Remote Mapping") { mappings.mapRemote.append(ProxyRemoteMapping()) }
        }
    }
}
