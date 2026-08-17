#if canImport(UIKit)
import SwiftUI
import HakkaCommon
import HakkaNetwork
import HakkaPerformance

// MARK: - DashboardView: Detailed Metrics disclosure

extension DashboardView {
    var detailedMetricsSection: some View {
        DisclosureGroup(isExpanded: $showDetails) {
            VStack(spacing: Theme.s16) {
                liveHudSection
                overviewSection
                performanceSection
                trafficSection
                domainSection
                methodSection
                slowestSection
                durationSection
                sizeSection
            }
            .padding(.top, Theme.s12)
        } label: {
            VStack(alignment: .leading, spacing: Theme.s2) {
                Text("Detailed metrics")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.text)
                Text("Counts, domains, slowest requests, and payload totals")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Theme.textTertiary)
            }
        }
        .tint(Theme.textSecondary)
        .padding(Theme.s14)
        .background(Theme.surface.opacity(0.72))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
    }

    var trafficSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            label("Traffic")
            HStack(spacing: Theme.s8) {
                card("Req/min", requestRateText, Theme.info)
                card("Payload", Fmt.formatBytes(totalPayloadBytes), Theme.methodPut)
                card("Avg size", averagePayloadText, Theme.text)
            }
        }
    }
}
#endif // canImport(UIKit)
