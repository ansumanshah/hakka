import SwiftUI

struct ProxyRoutingSection: View {
    @Bindable var routing: ProxyRoutingConfiguration
    let isCaptureActive: Bool

    var body: some View {
        Section("Outgoing routing") {
            Picker("Route", selection: $routing.mode) {
                Text("Direct").tag(ProxyRoutingConfiguration.Mode.direct)
                Text("Upstream proxy").tag(ProxyRoutingConfiguration.Mode.upstream)
                Text("PAC").tag(ProxyRoutingConfiguration.Mode.pac)
            }
            .pickerStyle(.segmented)
            .disabled(isCaptureActive)

            if routing.mode == .pac {
                Picker("PAC source", selection: $routing.pacSource) {
                    Text("File").tag(ProxyRoutingConfiguration.PACSource.file)
                    Text("URL").tag(ProxyRoutingConfiguration.PACSource.url)
                }
                .disabled(isCaptureActive)
                TextField(routing.pacSource == .file ? "/path/to/proxy.pac" : "https://example.com/proxy.pac", text: $routing.pacValue)
                    .textContentType(.URL)
                    .disabled(isCaptureActive)
                Text("Hakka loads this PAC source once when capture starts and follows FindProxyForURL for each outgoing request.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if routing.mode != .direct {
                TextField(routing.mode == .pac ? "Authenticated PAC proxy URL (optional)" : "http://proxy.example:8080", text: $routing.proxyURL)
                    .textContentType(.URL)
                    .disabled(isCaptureActive)
                TextField("Proxy username", text: $routing.username)
                    .textContentType(.username)
                    .disabled(isCaptureActive)
                SecureField("Proxy password", text: $routing.password)
                    .textContentType(.password)
                    .disabled(isCaptureActive)
                Text(routing.mode == .pac
                    ? "Credentials apply only when PAC selects this exact proxy URL. They stay in memory and the private launch file."
                    : "Credentials stay in memory and the private launch file. They are never placed in process arguments.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if !routing.username.isEmpty || !routing.password.isEmpty {
                    Button("Clear Proxy Credentials") { routing.clearCredentials() }
                        .disabled(isCaptureActive)
                }
            }
        }
    }
}
