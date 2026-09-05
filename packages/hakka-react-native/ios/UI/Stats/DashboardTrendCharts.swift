// @generated — do not edit. Synced from ios/Sources/UI/Stats/DashboardTrendCharts.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import SwiftUI
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif
#if canImport(HakkaPerformance)
import HakkaPerformance
#endif

// MARK: - DashboardView trend bar charts
//
// The two bar-chart `View`s `DashboardViewCharts.swift`'s `latencyTrend`/
// `payloadTrend` embed. Carry no access modifier — `DashboardView.LatencyPoint`/
// `PayloadPoint` (defined in `DashboardViewMetrics.swift`) are their inputs.

struct LatencyTrendChart: View {
    let points: [DashboardView.LatencyPoint]

    var body: some View {
        GeometryReader { proxy in
            let maxMs = max(points.map(\.duration).max() ?? 1, 1)
            let spacing: CGFloat = 3
            let barWidth = max(
                4,
                (proxy.size.width - CGFloat(max(points.count - 1, 0)) * spacing) / CGFloat(max(points.count, 1))
            )

            HStack(alignment: .bottom, spacing: spacing) {
                ForEach(points) { point in
                    latencyBar(
                        point: point,
                        maxMs: maxMs,
                        barWidth: barWidth,
                        chartHeight: proxy.size.height
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        }
    }

    private func latencyBar(
        point: DashboardView.LatencyPoint,
        maxMs: Int64,
        barWidth: CGFloat,
        chartHeight: CGFloat
    ) -> some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(color(for: point.duration))
            .frame(
                width: barWidth,
                height: max(4, chartHeight * CGFloat(point.duration) / CGFloat(maxMs))
            )
            .accessibilityLabel(Text("\(point.label), \(Fmt.formatDuration(point.duration))"))
    }

    private func color(for duration: Int64) -> Color {
        if duration <= 300 { return Theme.success }
        if duration <= 900 { return Theme.warning }
        return Theme.error
    }
}

struct PayloadTrendChart: View {
    let points: [DashboardView.PayloadPoint]

    var body: some View {
        GeometryReader { proxy in
            let maxBytes = max(points.map(\.bytes).max() ?? 1, 1)
            let spacing: CGFloat = 3
            let barWidth = max(
                4,
                (proxy.size.width - CGFloat(max(points.count - 1, 0)) * spacing) / CGFloat(max(points.count, 1))
            )

            HStack(alignment: .bottom, spacing: spacing) {
                ForEach(points) { point in
                    payloadBar(
                        point: point,
                        maxBytes: maxBytes,
                        barWidth: barWidth,
                        chartHeight: proxy.size.height
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        }
    }

    private func payloadBar(
        point: DashboardView.PayloadPoint,
        maxBytes: Int64,
        barWidth: CGFloat,
        chartHeight: CGFloat
    ) -> some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(color(for: point.bytes))
            .frame(
                width: barWidth,
                height: max(4, chartHeight * CGFloat(point.bytes) / CGFloat(maxBytes))
            )
            .accessibilityLabel(Text("\(point.label), \(Fmt.formatBytes(point.bytes))"))
    }

    private func color(for bytes: Int64) -> Color {
        if bytes <= 1_024 { return Theme.info }
        if bytes <= 64 * 1_024 { return Theme.methodPut }
        return Theme.warning
    }
}
#endif // canImport(UIKit)
