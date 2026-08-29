import HakkaCore
import HakkaCommon
import SwiftUI

/// The Timing tab's content: the record's phases as a proportional
/// waterfall — each bar's width is that phase's share of the phase sum.
/// Records without phases degrade to a single total bar with a note.
struct DetailTimingSection: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xl) {
            VStack(alignment: .leading, spacing: Spacing.sm) {
                sectionTitle
                VStack(alignment: .leading, spacing: Spacing.md) {
                    ForEach(Array(plan.rows.enumerated()), id: \.element.id) { index, row in
                        TimingBarRow(row: row, color: color(for: row.label), index: index)
                    }
                    if let note = plan.note {
                        Text(note)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(Spacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.secondary.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            if let connectionFacts {
                ConnectionFactsSection(facts: connectionFacts)
            }
            if let redirectChain {
                RedirectChainSection(chain: redirectChain)
            }
        }
    }

    private var plan: TimingWaterfallPlan {
        TimingWaterfallPlan(
            dnsMs: record.dnsMs,
            tlsMs: record.tlsMs,
            connectMs: record.connectMs,
            ttfbMs: record.ttfbMs,
            downloadMs: record.downloadMs,
            durationMs: record.duration
        )
    }

    /// "Waterfall" plus a total-duration badge, mirroring the design's
    /// `<div class="stitle">Waterfall <span class="badge">300 ms</span></div>`.
    private var sectionTitle: some View {
        HStack(spacing: Spacing.sm) {
            Text("Waterfall")
                .font(.caption2)
                .foregroundStyle(.tertiary)
            Text(Fmt.duration(plan.totalMs))
                .font(.caption2.monospaced())
                .foregroundStyle(.secondary)
                .padding(.horizontal, Spacing.sm)
                .padding(.vertical, Spacing.xxs)
                .background(Color.secondary.opacity(0.15), in: Capsule())
        }
    }

    private var connectionFacts: ConnectionFacts? {
        ConnectionFacts(
            networkProtocol: record.networkProtocol,
            tlsVersion: record.tlsVersion,
            cipherSuite: record.cipherSuite
        )
    }

    private var redirectChain: RedirectChain? {
        RedirectChain(redirectUrls: record.redirectUrls, finalUrl: record.url)
    }

    private func color(for label: String) -> Color {
        // The heat-ramp tokens: DNS renders cold, download hot — the same
        // ramp the other four platforms' timing bars use.
        switch label {
        case "DNS": ThemeTokens.Timing.dns
        case "TCP": ThemeTokens.Timing.tcp
        case "TLS": ThemeTokens.Timing.tls
        case "TTFB": ThemeTokens.Timing.ttfb
        case "Download": ThemeTokens.Timing.download
        default: .secondary
        }
    }
}

/// One waterfall line: label, a track with the phase's bar positioned at its
/// real start offset on the shared timeline (not stacked at zero), and the
/// value. Absent phases render an empty track and a dash. Bars animate in
/// staggered by row index, `.easeOut(duration: 0.4).delay(index * 0.05)` —
/// this repo's convention for staggered-growth timing bars.
private struct TimingBarRow: View {
    let row: TimingWaterfallPlan.Row
    let color: Color
    let index: Int

    @State private var isVisible = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: Spacing.md) {
            Text(row.label)
                .font(.caption)
                .frame(width: 64, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    Capsule()
                        .fill(color)
                        .frame(width: geo.size.width * (isVisible ? row.fraction : 0))
                        .offset(x: geo.size.width * row.offsetFraction)
                }
            }
            .frame(height: 6)  // ui-token-check-ignore: timing bar track
            Text(Fmt.duration(row.ms))
                .font(.caption.monospaced().weight(.medium))
                .frame(width: 72, alignment: .trailing)
                .foregroundStyle(row.ms == nil ? .secondary : .primary)
        }
        .padding(.vertical, 1)
        .onAppear {
            guard !reduceMotion else {
                isVisible = true
                return
            }
            withAnimation(.easeOut(duration: 0.4).delay(Double(index) * 0.05)) {
                isVisible = true
            }
        }
    }
}
