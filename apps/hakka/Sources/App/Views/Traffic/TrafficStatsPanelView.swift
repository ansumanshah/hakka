import HakkaCore
import SwiftUI

/// Surfaces `TrafficStatsAccumulator`'s running totals (SPEC.md §2 footnote
/// 27: the accumulator "compute[s] exactly what SPEC §2 calls for... live,
/// on every `TrafficStore.append`", but before this view the only consumer
/// was `LiveTrafficHeader`'s single request-count line). Every row below
/// reads a field `TrafficStats` already carries — count, error rate, p50/p95
/// duration, byte totals — nothing here computes a metric of its own.
///
/// A popover off a toolbar button, not a new tab: `SidebarSelection` has no
/// `.stats` case, and adding one is out of this view's scope (see the
/// workstream brief). `TrafficColumnPickerView` is the pattern this follows —
/// a small fixed-width popover fed a value type directly rather than reading
/// `AppModel` itself, so it stays trivial to preview and test.
struct TrafficStatsPanelView: View {
    let stats: TrafficStats

    private var content: TrafficStatsPanelContent {
        TrafficStatsPanelContent(stats: stats)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Stats")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, Spacing.lg)
                .padding(.top, Spacing.ml)
            VStack(spacing: Spacing.sm) {
                row("Requests", content.requestCount)
                row("Errors", content.errorSummary, valueColor: stats.errorCount > 0 ? ThemeTokens.Status.error : nil)
                Divider()
                row("p50 duration", content.p50Duration)
                row("p95 duration", content.p95Duration)
                Divider()
                row("Total bytes", content.totalBytes)
            }
            .padding(Spacing.lg)
        }
        .frame(width: 220)
    }

    private func row(_ label: String, _ value: String, valueColor: Color? = nil) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption.monospacedDigit())
                .foregroundStyle(valueColor ?? .primary)
        }
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
