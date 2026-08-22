import HakkaCore
import HakkaCommon
import SwiftUI

/// The redirect chain: every hop the request actually bounced through, in
/// order, ending at the URL it landed on. A count alone hides which hosts
/// were involved — this is the useful version.
struct RedirectChainSection: View {
    let chain: RedirectChain

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            Text("Redirects")
                .font(.caption2)
                .foregroundStyle(.tertiary)
            VStack(alignment: .leading, spacing: Spacing.xs) {
                ForEach(chain.hops) { hop in
                    RedirectHopRow(hop: hop)
                }
            }
        }
        .padding(Spacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct RedirectHopRow: View {
    let hop: RedirectChain.Hop

    var body: some View {
        HStack(spacing: Spacing.md) {
            Image(systemName: hop.isFinal ? "checkmark.circle" : "arrow.turn.down.right")
                .font(.caption2)
                .foregroundStyle(hop.isFinal ? ThemeTokens.Status.success : .secondary)
                .frame(width: 14)
            Text(hop.url)
                .font(.caption.monospaced())
                .foregroundStyle(hop.isFinal ? .primary : .secondary)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}
