// @generated — do not edit. Synced from ios/Sources/UI/Detail/RedirectChainView.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI

// MARK: - RedirectChainView

/// Vertical redirect chain visualization showing each hop with status and URL.
///
/// Displays redirect URLs as a vertical flow with arrow connectors between steps,
/// ending with the final destination URL.
struct RedirectChainView: View {
    let redirectUrls: [String]
    let finalUrl: String
    let finalStatus: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(redirectUrls.enumerated()), id: \.offset) { index, url in
                redirectStep(
                    url: url,
                    statusLabel: redirectStatusLabel(for: index),
                    statusColor: Theme.info,
                    isLast: false
                )
            }

            redirectStep(
                url: finalUrl,
                statusLabel: finalStatus.map { "\($0)" } ?? "---",
                statusColor: Theme.statusColor(for: finalStatus),
                isLast: true
            )
        }
        .padding(.vertical, Theme.s4)
    }

    // MARK: - Step Row

    private func redirectStep(
        url: String,
        statusLabel: String,
        statusColor: Color,
        isLast: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: Theme.s8) {
                Text(statusLabel)
                    .font(.caption2.monospacedDigit())
                    .fontWeight(.semibold)
                    .foregroundStyle(statusColor)
                    .frame(width: 32, alignment: .center)
                    .padding(.vertical, Theme.s2)
                    .background(statusColor.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusS))

                // URL (path only for compact display)
                Text(compactUrl(url))
                    .font(.caption2.monospaced())
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }

            if !isLast {
                // Arrow connector between steps
                HStack(spacing: 0) {
                    Spacer().frame(width: 14)
                    VStack(spacing: 1) {
                        Rectangle()
                            .fill(Theme.border)
                            .frame(width: 1, height: 8)  // ui-token-check-ignore: chart bar or plot-area geometry
                        Image(systemName: "arrow.down")
                            .font(.system(size: Theme.iconXS))
                            .foregroundStyle(Theme.border)
                        Rectangle()
                            .fill(Theme.border)
                            .frame(width: 1, height: 4)  // ui-token-check-ignore: rule/rail thickness
                    }
                }
                .frame(height: HakkaMetrics.ControlHeight.chip)
            }
        }
    }

    // MARK: - Helpers

    /// Infer redirect status code from position. First redirects are typically 301/302.
    private func redirectStatusLabel(for index: Int) -> String {
        // No per-hop status codes are available, so show "3xx" as a generic redirect indicator.
        "3xx"
    }

    /// Show host + path for compact display, full URL if short enough.
    private func compactUrl(_ url: String) -> String {
        guard let parsed = URL(string: url) else { return url }
        let host = parsed.host ?? ""
        let path = parsed.path.isEmpty ? "/" : parsed.path
        return "\(host)\(path)"
    }
}

#if DEBUG
#Preview("RedirectChain") {
    RedirectChainView(
        redirectUrls: [
            "https://example.com/a",
            "https://example.com/b",
            "https://example.com/c",
        ],
        finalUrl: "https://example.com/final",
        finalStatus: 200
    )
    .padding()
    .background(Theme.bg)
}
#endif
#endif // canImport(UIKit)
