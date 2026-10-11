import HakkaCore
import SwiftUI

/// Readable totals from the existing traffic accumulator, shown in a native popover.
struct TrafficStatsPanelView: View {
    let stats: TrafficStats

    private var content: TrafficStatsPanelContent {
        TrafficStatsPanelContent(stats: stats)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.lg) {
            Text("Traffic Stats")
                .font(.headline)
                .foregroundStyle(ThemeTokens.Palette.text)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: Spacing.lg) {
                row("Requests", content.requestCount)
                row("Errors", content.errorSummary, valueColor: stats.errorCount > 0 ? ThemeTokens.Status.error : nil)
                Divider()
                row("p50 duration", content.p50Duration)
                row("p95 duration", content.p95Duration)
                Divider()
                row("Total bytes", content.totalBytes)
            }
        }
        .padding(Layout.gutter)
        .background(ThemeTokens.Palette.surfaceRaised)
        .frame(width: 280) // ui-token-check-ignore: statistics popover reading measure
    }

    private func row(_ label: String, _ value: String, valueColor: Color? = nil) -> some View {
        TrafficStatRow(label: label, value: value, valueColor: valueColor)
    }
}

private struct TrafficStatRow: View {
    let label: String
    let value: String
    let valueColor: Color?
    var body: some View {
        HStack {
            Text(label)
                .font(.callout)
                .foregroundStyle(ThemeTokens.Palette.textSecondary)
            Spacer()
            Text(value)
                .font(.callout.monospacedDigit().weight(.medium))
                .foregroundStyle(valueColor ?? ThemeTokens.Palette.text)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The view's formatted strings, split out as a plain value type so its
/// output is snapshot-testable without instantiating SwiftUI — mirrors how
/// `Fmt` (`Sources/App/Shared/Fmt.swift`) keeps formatting logic independent
/// of any view.
struct TrafficStatsPanelContent: Equatable {
    let requestCount: String
    let errorSummary: String
    let p50Duration: String
    let p95Duration: String
    let totalBytes: String

    init(stats: TrafficStats) {
        requestCount = "\(stats.count)"
        errorSummary = "\(stats.errorCount) (\(Self.percent(stats.errorRate)))"
        p50Duration = Fmt.duration(stats.p50DurationMs)
        p95Duration = Fmt.duration(stats.p95DurationMs)
        totalBytes = Fmt.bytes(stats.totalBytes)
    }

    private static func percent(_ ratio: Double) -> String {
        String(format: "%.1f%%", ratio * 100)
    }
}
