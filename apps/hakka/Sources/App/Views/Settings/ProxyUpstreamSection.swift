import SwiftUI

struct ProxyUpstreamSection: View {
    @Bindable var upstream: ProxyUpstream
    let isCaptureActive: Bool

    var body: some View {
        Section("Upstream proxy") {
            TextField("http://proxy.example:8080", text: $upstream.url)
                .textContentType(.URL)
                .disabled(isCaptureActive)
            Text("Optionally chain capture through an HTTP or HTTPS proxy. Include its host and port. Credentials and PAC URLs are not supported.")
                .font(.callout)
                .foregroundStyle(.secondary)
            if !upstream.url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button("Clear Upstream Proxy") { upstream.reset() }
                    .disabled(isCaptureActive)
            }
        }
    }
}
