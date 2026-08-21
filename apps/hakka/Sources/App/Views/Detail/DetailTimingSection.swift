import HakkaCore
import HakkaCommon
import SwiftUI

/// The Timing tab's content: the record's phases as a proportional
/// waterfall — each bar's width is that phase's share of the phase sum.
/// Records without phases degrade to a single total bar with a note.
struct DetailTimingSection: View {
    let record: NetworkRequest

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(plan.rows) { row in
                TimingBarRow(row: row, color: color(for: row.label))
            }
            if let note = plan.note {
                Text(note)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 6))
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

/// One waterfall line: label, a track with the phase's bar, and the value.
/// Absent phases render an empty track and a dash.
private struct TimingBarRow: View {
    let row: TimingWaterfallPlan.Row
    let color: Color

    var body: some View {
        HStack(spacing: 8) {
            Text(row.label)
                .font(.caption)
                .frame(width: 64, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.secondary.opacity(0.15))
                    Capsule()
                        .fill(color)
                        .frame(width: geo.size.width * row.fraction)
                }
            }
            .frame(height: 6)
            Text(Fmt.duration(row.ms))
                .font(.caption.monospaced().weight(.medium))
                .frame(width: 72, alignment: .trailing)
                .foregroundStyle(row.ms == nil ? .secondary : .primary)
        }
        .padding(.vertical, 1)
    }
}
