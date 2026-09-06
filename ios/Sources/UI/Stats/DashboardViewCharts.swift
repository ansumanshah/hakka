#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork
import HakkaPerformance

// MARK: - DashboardView: Charts
//
// Latency/payload trend bars plus the status proportion bars. Chart data
// points (`latencyPoints`/`payloadPoints`) live in `DashboardViewMetrics.swift`;
// the bar-chart `View`s themselves (`LatencyTrendChart`/`PayloadTrendChart`)
// live in `DashboardTrendCharts.swift`.

extension DashboardView {
    var chartSection: some View {
        Group {
            if !requests.isEmpty {
                VStack(alignment: .leading, spacing: Theme.s10) {
                    label("Charts")
                    latencyTrend
                    payloadTrend
                    statusMix
                    statusClassSection
                }
            }
        }
    }

    var latencyTrend: some View {
        let points = latencyPoints
        return VStack(alignment: .leading, spacing: Theme.s8) {
            HStack {
                Text("Latency trend")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("Recent \(points.count)")
                    .font(.caption2.monospacedDigit().weight(.medium))
                    .foregroundStyle(Theme.textTertiary)
            }

            LatencyTrendChart(points: points)
            .frame(height: 72)  // ui-token-check-ignore: chart bar or plot-area geometry
        }
        .hakkaGroupedCard()
    }

    var payloadTrend: some View {
        let points = payloadPoints
        return VStack(alignment: .leading, spacing: Theme.s8) {
            HStack {
                Text("Payload trend")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text(Fmt.formatBytes(totalPayloadBytes))
                    .font(.caption2.monospacedDigit().weight(.medium))
                    .foregroundStyle(Theme.textTertiary)
            }

            PayloadTrendChart(points: points)
                .frame(height: 58)  // ui-token-check-ignore: chart bar or plot-area geometry
        }
        .hakkaGroupedCard()
    }

    var statusMix: some View {
        let ok = successCount
        let failed = errorCount
        let other = max(0, requests.count - ok - failed)
        return VStack(alignment: .leading, spacing: Theme.s8) {
            HStack {
                Text("Status mix")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("\(ok) ok  \(failed) err")
                    .font(.caption2.monospacedDigit().weight(.medium))
                    .foregroundStyle(Theme.textTertiary)
            }
            GeometryReader { geo in
                let total = max(requests.count, 1)
                HStack(spacing: HakkaMetrics.Spacing.xxs) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Theme.success)
                        .frame(width: geo.size.width * CGFloat(ok) / CGFloat(total))
                    if other > 0 {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Theme.warning)
                            .frame(width: geo.size.width * CGFloat(other) / CGFloat(total))
                    }
                    if failed > 0 {
                        RoundedRectangle(cornerRadius: 4)
                            .fill(Theme.error)
                            .frame(width: geo.size.width * CGFloat(failed) / CGFloat(total))
                    }
                }
            }
            .frame(height: 14)  // ui-token-check-ignore: chart bar or plot-area geometry
        }
        .hakkaGroupedCard()
    }

    /// HTTP status-class breakdown (2xx/3xx/4xx/5xx), same proportion-bar grammar as `statusMix`.
    var statusClassSection: some View {
        let counts = statusClassCounts
        let total = requests.count
        let entries: [(String, Int, Color)] = [
            ("2xx", counts.twoXX, Theme.success),
            ("3xx", counts.threeXX, Theme.info),
            ("4xx", counts.fourXX, Theme.warning),
            ("5xx", counts.fiveXX, Theme.error),
        ]
        return VStack(alignment: .leading, spacing: Theme.s8) {
            HStack {
                Text("Status")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("\(counts.twoXX + counts.threeXX + counts.fourXX + counts.fiveXX) classified")
                    .font(.caption2.monospacedDigit().weight(.medium))
                    .foregroundStyle(Theme.textTertiary)
            }
            ForEach(entries, id: \.0) { name, count, color in
                statusClassRow(label: name, count: count, total: total, color: color)
            }
        }
        .hakkaGroupedCard()
    }

    func statusClassRow(label: String, count: Int, total: Int, color: Color) -> some View {
        let pct = total > 0 ? Double(count) / Double(total) * 100 : 0
        return HStack(spacing: Theme.s8) {
            Text(label)
                .font(.caption.monospaced().weight(.medium))
                .foregroundStyle(color)
                .frame(width: 32, alignment: .leading)

            GeometryReader { geo in
                let frac = total > 0 ? CGFloat(count) / CGFloat(total) : 0
                RoundedRectangle(cornerRadius: Theme.radiusS)
                    .fill(color)
                    .frame(width: max(count > 0 ? 4 : 0, geo.size.width * frac))
            }
            .frame(height: 10)  // ui-token-check-ignore: chart bar or plot-area geometry

            Text("\(count) (\(String(format: "%.0f", pct))%)")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.textTertiary)
                .frame(width: 64, alignment: .trailing)
        }
    }
}
#endif // canImport(UIKit)
