// @generated — do not edit. Synced from ios/Sources/UI/Stats/DashboardViewOverview.swift
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

// MARK: - DashboardView: Summary / Live HUD / Overview / Performance
//
// The top-of-scroll cards: the always-visible summary header, plus the
// three cards that open under the "Detailed metrics" disclosure (Live HUD,
// Overview counts, Performance). See `DashboardViewDetail.swift` for the
// disclosure container these last three sit inside.

extension DashboardView {
    // MARK: - Summary

    var summarySection: some View {
        let status = sessionStatus
        return VStack(alignment: .leading, spacing: Theme.s12) {
            HStack(alignment: .top, spacing: Theme.s12) {
                Image(systemName: status.icon)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(status.color)
                    .frame(width: HakkaMetrics.ControlHeight.field, height: HakkaMetrics.ControlHeight.field)
                    .background(status.color.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))

                VStack(alignment: .leading, spacing: Theme.s4) {
                    Text(status.title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Theme.text)
                    Text(status.subtitle)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: Theme.s8) {
                summaryPill("Capture", captureSummary, captureSummaryColor)
                summaryPill("Latency", latencySummary, latencySummaryColor)
                summaryPill("UI", uiSummary, uiSummaryColor)
            }
        }
        .padding(Theme.s14)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
    }

    func summaryPill(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: Theme.s4) {
            Text(title)
                .font(.caption2.weight(.heavy))
                .foregroundStyle(Theme.textTertiary)
            Text(value)
                .font(.caption.weight(.bold))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Theme.s10)
        .padding(.vertical, Theme.s8)
        .background(color.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusM))
    }

    // MARK: - Live HUD

    var liveHudSection: some View {
        let frames = performanceMonitor.snapshot
        let resources = performanceMonitor.resourceSnapshot
        return VStack(alignment: .leading, spacing: Theme.s8) {
            label("Live HUD")
            HStack(spacing: Theme.s8) {
                hudLane("REQ", "\(requests.count)", Theme.text)
                hudLane(networkCaption, networkValue, performanceColor(networkP95))
                hudLane("FPS", frameFpsText(frames), frameFpsColor(frames))
                hudLane("SLOW", frameJankText(frames), frameRateColor(frames))
            }
            HStack(spacing: Theme.s8) {
                hudLane("MEM", resources.memoryDisplay, Theme.info)
                hudLane("CPU", resources.cpuDisplay, Theme.text)
            }
        }
        .padding(Theme.s12)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: Theme.radiusL))
    }

    // MARK: - Overview

    var overviewSection: some View {
        VStack(alignment: .leading, spacing: Theme.s8) {
            label("Overview")
            HStack(spacing: Theme.s8) {
                card("Total", "\(requests.count)", Theme.text)
                card("Success", "\(successCount)", Theme.success)
                card("Errors", "\(errorCount)", errorCount > 0 ? Theme.error : Theme.pending)
            }
            HStack(spacing: Theme.s8) {
                card("Unique hosts", "\(uniqueHostCount)", Theme.info)
            }
        }
    }

    // MARK: - Performance

    var performanceSection: some View {
        let health = HakkaInterceptor.shared.healthReport()
        let frames = performanceMonitor.snapshot

        return Group {
            VStack(alignment: .leading, spacing: Theme.s8) {
                label("Performance")
                HStack(spacing: Theme.s8) {
                    card("Latency", networkP95Text, performanceColor(networkP95))
                    card("Err Rate", percentText(health.errorRate), errorRateColor(health.errorRate))
                    card("Slow frames", frameRateText(frames), frameRateColor(frames))
                }
                Text(performanceCaption(from: health, frames: frames))
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }
}
#endif // canImport(UIKit)
