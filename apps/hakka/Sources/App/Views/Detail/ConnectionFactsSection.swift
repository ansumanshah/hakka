import HakkaCore
import HakkaCommon
import SwiftUI

/// The negotiated network protocol, TLS version, and cipher suite —
/// connection-level facts `URLSessionTaskMetrics` already hands the SDK,
/// shown beside the timing waterfall since they're the same connection
/// story. Renders only the facts that are actually present.
struct ConnectionFactsSection: View {
    let facts: ConnectionFacts

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Connection")
                .font(.caption2)
                .foregroundStyle(.tertiary)
            HStack(spacing: 16) {
                if let networkProtocol = facts.networkProtocol {
                    fact("network", "Protocol", networkProtocol)
                }
                if let tlsVersion = facts.tlsVersion {
                    fact("lock", "TLS", tlsVersion)
                }
                if let cipherSuite = facts.cipherSuite {
                    fact("key", "Cipher", cipherSuite)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func fact(_ systemImage: String, _ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(label, systemImage: systemImage)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .labelStyle(.titleAndIcon)
            Text(value)
                .font(.caption.monospaced())
                .foregroundStyle(.primary)
                .textSelection(.enabled)
        }
    }
}
