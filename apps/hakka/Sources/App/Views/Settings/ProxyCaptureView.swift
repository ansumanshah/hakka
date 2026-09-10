import AppKit
import SwiftUI
import UniformTypeIdentifiers

struct ProxyCaptureView: View {
    private enum Page: String, CaseIterable {
        case overview = "Overview"
        case connect = "Connections"
        case https = "HTTPS"
        case routing = "Routing"
        case rules = "Rules"
        case automation = "Automation"
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var app
    @State private var addresses = ProxyDeviceAddress.activeAddresses()
    @State private var page = Page.overview
    private let isEmbedded: Bool

    init(isEmbedded: Bool = false) {
        self.isEmbedded = isEmbedded
    }

    var body: some View {
        @Bindable var proxy = app.proxy
        VStack(spacing: 0) {
            ProxyCaptureStatusHeader(
                proxy: proxy,
                bridgePort: app.traffic.boundPort,
                bridgeRunning: app.traffic.isRunning,
                bridgeError: app.traffic.startupError,
                showConnection: showConnection,
            )
            Divider()
            pageNavigation
            Divider()
            Form {
                switch page {
                case .overview:
                    ProxyOverviewView(proxy: proxy, bridgeRunning: app.traffic.isRunning) {
                        page = .connect
                    }
                case .connect:
                    connectPage(proxy: proxy)
                case .https:
                    httpsPage(proxy: proxy)
                case .routing:
                    routingPage(proxy: proxy)
                case .rules:
                    rulesPage(proxy: proxy)
                case .automation:
                    automationPage(proxy: proxy)
                }
            }
            .formStyle(.grouped)
            .controlSize(.small)
        }
        .frame(minWidth: 600, minHeight: 560) // ui-token-check-ignore: window chrome
        .navigationTitle("Proxy Capture")
    }

    private var pageNavigation: some View {
        HStack {
            ViewThatFits(in: .horizontal) {
                pagePicker
                    .fixedSize()
                Menu {
                    Picker("Proxy section", selection: $page) {
                        ForEach(Page.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                } label: { Text(page.rawValue) }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Layout.gutter)
        .padding(.vertical, Spacing.sm)
    }

    private var pagePicker: some View {
        Picker("Proxy section", selection: $page) {
            ForEach(Page.allCases, id: \.self) { page in
                Text(page.rawValue).tag(page)
            }
        }
        .labelsHidden()
        .pickerStyle(.segmented)
        .controlSize(.small)
        .fixedSize()
        .accessibilityLabel("Proxy section")
    }

    @ViewBuilder
    private func connectPage(proxy: ProxyCaptureModel) -> some View {
        @Bindable var proxy = proxy
        Section("Listen") {
            TextField("Port", value: $proxy.port, format: .number.grouping(.never))
            Toggle("Allow devices on the local network", isOn: $proxy.allowLAN)
        }
        .disabled(proxy.isActive)

        ProxySetupSection(proxy: proxy)

        Section("Connect an app or device") {
            LabeledContent("This Mac", value: "127.0.0.1:\(proxy.port)")
                .textSelection(.enabled)
            if proxy.allowLAN {
                ForEach(addresses, id: \.self) { address in
                    LabeledContent("Device proxy", value: "\(address):\(proxy.port)")
                        .textSelection(.enabled)
                }
                if addresses.isEmpty {
                    Text("Connect this Mac to Wi-Fi or Ethernet to show its address.")
                        .foregroundStyle(.secondary)
                }
                Text("On your phone, open the connected Wi-Fi network’s proxy settings. Choose Manual, then enter one of the addresses above and port \(proxy.port).")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Button("Refresh Addresses") {
                    addresses = ProxyDeviceAddress.activeAddresses()
                }
                Button("Open Network Settings") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.Network-Settings.extension") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
        }

        Section("This Mac") {
            if proxy.isSystemProxyRoutingRecoveryPending {
                Button("Restore Previous Proxy Settings") {
                    Task { await proxy.retrySystemProxyRoutingRecovery() }
                }
                .disabled(proxy.isActive || proxy.isRecoveringSystemProxyRouting)
            }
            Toggle("Route this Mac through Hakka while capture runs", isOn: $proxy.routeThisMac)
                .disabled(proxy.isActive)
            Text("Hakka snapshots HTTP and HTTPS proxy settings for each enabled network service before changing them. It restores only settings that still point to this capture session, so a change you make in System Settings is kept.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("Launch an App Through Hakka…") {
                chooseApplication { path in
                    do {
                        try proxy.launchThroughProxy(executable: URL(fileURLWithPath: path))
                    } catch {
                        proxy.reportLaunchFailure(error)
                    }
                }
            }
            .disabled(proxy.state != .running)
            Text("The selected app receives proxy and certificate environment variables for this launch only. Hakka does not edit its preferences or install a profile.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }

    }

    @ViewBuilder
    private func httpsPage(proxy: ProxyCaptureModel) -> some View {
        Section("HTTPS setup") {
            Text("Start capture, set the device’s proxy, then visit mitm.it through it to trust the public certificate. Trust is configured on the test device; Hakka does not change system trust.")
                .font(.callout)
            HStack {
                Button("Copy Setup Address") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("http://mitm.it", forType: .string)
                }
                Button("Show Public Certificate") {
                    if let path = proxy.certificatePath {
                        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
                    }
                }
                .disabled(proxy.certificatePath == nil)
            }
        }

        ProxyRuntimeSetupSection(port: proxy.port, certificatePath: proxy.certificatePath)
    }

    @ViewBuilder
    private func rulesPage(proxy: ProxyCaptureModel) -> some View {
        @Bindable var proxy = proxy
        Section {
            Text("Rules apply when capture starts. Stop capture before editing. These rules affect apps using this proxy.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        Section("Live breakpoints") {
            Toggle("Enable proxy breakpoints for this session", isOn: $proxy.enableBreakpoints)
                .disabled(proxy.isActive)
            Text("Uses the desktop Rules and pause inbox. Other clients connected to the desktop bridge can control enabled breakpoints. This setting resets when Hakka quits.")
                .font(.callout)
                .foregroundStyle(.secondary)
            Button("Manage Breakpoints") {
                app.select(.rules)
                if !isEmbedded {
                    dismiss()
                }
            }
        }
        Section("TLS host scope") {
            TLSHostScopeEditor(scope: $proxy.tlsHostScope)
        }
        .disabled(proxy.isActive)
        Section("Map Local and Remote") {
            ProxyMappingsEditor(mappings: $proxy.mappings)
        }
        .disabled(proxy.isActive)
        ProxyRulesEditor(mappings: $proxy.mappings)
            .disabled(proxy.isActive)
    }

    @ViewBuilder
    private func routingPage(proxy: ProxyCaptureModel) -> some View {
        @Bindable var proxy = proxy
        ProxyRoutingSection(
            routing: proxy.routingConfiguration,
            isCaptureActive: proxy.isActive,
        )
        ProxyBandwidthSection(configuration: $proxy.bandwidthConfiguration)
            .disabled(proxy.isActive)
    }

    @ViewBuilder
    private func automationPage(proxy: ProxyCaptureModel) -> some View {
        @Bindable var proxy = proxy
        ProxyScriptEditor(configuration: $proxy.scriptConfiguration)
            .disabled(proxy.isActive)
        Section("Agents") {
            Toggle("Allow agents to start and stop this proxy", isOn: $proxy.allowAgentControl)
            Text("Enable the MCP server in Settings to expose proxy_status, proxy_start, and proxy_stop. Agents use the configuration shown here; this permission resets when Hakka quits.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
        Section {
            DisclosureGroup("Advanced") {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    HStack {
                        TextField("Hakka CLI", text: $proxy.cliPath)
                        Button("Choose CLI…") {
                            chooseFile { proxy.cliPath = $0 }
                        }
                    }
                    HStack {
                        TextField("Node executable", text: $proxy.nodePath)
                        Button("Choose Node…") {
                            chooseFile { proxy.nodePath = $0 }
                        }
                    }
                    Text("Use an installed hakka executable or built cli.mjs. Install mitmproxy separately. These paths are passed directly to the process, without a shell.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, Spacing.sm)
            }
            .disabled(proxy.isActive)
        }
    }

    private func showConnection() {
        app.select(.traffic)
        if !isEmbedded {
            dismiss()
        }
    }

    private func chooseFile(_ select: (String) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            select(url.path)
        }
    }

    private func chooseApplication(_ select: (String) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.applicationBundle, .unixExecutable]
        if panel.runModal() == .OK, let url = panel.url {
            select(url.path)
        }
    }
}
