// @generated — do not edit. Synced from ios/Sources/UI/Overlay/BubbleWindowDisplay.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

#if canImport(UIKit)
import Foundation
import UIKit
#if canImport(HakkaCommon)
import HakkaCommon
#endif
#if canImport(HakkaNetwork)
import HakkaNetwork
#endif
#if canImport(HakkaPerformance)
import HakkaPerformance
#endif

// MARK: - BubbleStats

struct BubbleStats {
    var total: Int = 0
    var success: Int = 0
    var errors: Int = 0
    private var p95Duration: Int64?

    init() {}

    init(summary: NetworkMetricsSummary) {
        total = summary.totalRequests
        success = summary.successCount
        errors = summary.errorCount
        p95Duration = summary.p95LatencyMs
    }

    var healthColor: UIColor {
        guard total > 0 else {
            return UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        }
        let rate = Double(success) / Double(total)
        if rate >= 0.95 { return UIColor(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255, alpha: 1) }
        if rate >= 0.85 { return UIColor(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255, alpha: 1) }
        return UIColor(red: 0xF8 / 255, green: 0x71 / 255, blue: 0x71 / 255, alpha: 1)
    }

    var networkValue: String {
        if errors > 0 { return Self.compact(errors) }
        guard let p95 = p95Duration else { return "--" }
        return Self.formatDuration(p95)
    }

    var networkCaption: String {
        errors > 0 ? "ERR" : "LAT"
    }

    var networkColor: UIColor {
        if errors > 0 {
            return UIColor(red: 0xF8 / 255, green: 0x71 / 255, blue: 0x71 / 255, alpha: 1)
        }
        guard let p95 = p95Duration else {
            return UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        }
        if p95 <= 350 { return UIColor(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255, alpha: 1) }
        if p95 <= 1_000 { return UIColor(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255, alpha: 1) }
        return UIColor(red: 0xF8 / 255, green: 0x71 / 255, blue: 0x71 / 255, alpha: 1)
    }

    var spokenNetworkValue: String {
        guard let p95 = p95Duration else { return "unavailable" }
        return Self.spokenDuration(p95)
    }

    mutating func record(status: Int?) {
        total += 1
        if let code = status, (200..<400).contains(code) { success += 1 }
        if status.map({ $0 >= 400 }) == true { errors += 1 }
    }

    private static func compact(_ n: Int) -> String {
        if n < 1000 { return "\(n)" }
        if n < 10_000 { return String(format: "%.1fK", Double(n) / 1000) }
        return "\(n / 1000)K"
    }

    private static func formatDuration(_ ms: Int64) -> String {
        if ms < 1_000 { return "\(ms)ms" }
        if ms < 10_000 { return String(format: "%.1fs", Double(ms) / 1_000) }
        return "\(ms / 1_000)s"
    }

    private static func spokenDuration(_ ms: Int64) -> String {
        if ms == 1 { return "1 millisecond" }
        if ms < 1_000 { return "\(ms) milliseconds" }

        let seconds = Double(ms) / 1_000
        if seconds == 1 { return "1 second" }
        if ms < 10_000 { return String(format: "%.1f seconds", seconds) }
        return "\(ms / 1_000) seconds"
    }
}

/// Bubble-only UIColor formatting for the shared `PerformanceFrameStats`
/// aggregation model (see `ios/Sources/UI/Helpers/PerformanceFrameStats.swift`).
/// `private extension` keeps these file-scoped — the Monitor dashboard reads
/// the same struct through its `Color`-based `HakkaUIPerformanceSnapshot`
/// instead (see `DashboardView.swift`).
private extension PerformanceFrameStats {
    var displayValue: String {
        guard isFresh, let fps else { return "--" }
        return String(format: "%.0f", max(0, fps))
    }

    var displayColor: UIColor {
        guard isFresh, let fps else {
            return UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        }
        let target = max(refreshRateHz ?? 60.0, 1.0)
        let ratio = fps / target
        if ratio >= 0.90 { return UIColor(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255, alpha: 1) }
        if ratio >= 0.75 { return UIColor(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255, alpha: 1) }
        return UIColor(red: 0xF8 / 255, green: 0x71 / 255, blue: 0x71 / 255, alpha: 1)
    }

    var slowFrameValue: String {
        guard isFresh else { return "--" }
        guard let slowFrameRate else { return "--" }
        return String(format: "%.0f", slowFrameRate * 100)
    }

    var slowFrameColor: UIColor {
        guard isFresh, let slowFrameRate else {
            return UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
        }
        if slowFrameRate <= 0.05 { return UIColor(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255, alpha: 1) }
        if slowFrameRate <= 0.12 { return UIColor(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255, alpha: 1) }
        return UIColor(red: 0xF8 / 255, green: 0x71 / 255, blue: 0x71 / 255, alpha: 1)
    }
}

// MARK: - HakkaUIPerformanceSnapshot

public struct HakkaUIPerformanceSnapshot: Sendable {
    public let fps: Double?
    public let refreshRateHz: Double?
    public let slowFrameRate: Double?
    public let frozenFrameCount: Int
    public let isFresh: Bool
}

// MARK: - BubbleWindow + Display

extension BubbleWindow {

    func updateDisplay() {
        numeratorLabel?.text = formatCompact(stats.total)
        numeratorLabel?.textColor = .white
        denominatorLabel?.textColor = stats.total > 0
            ? UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)
            : UIColor(red: 0x74 / 255, green: 0x80 / 255, blue: 0x94 / 255, alpha: 1)

        // Request + error counts are exact and always safe to show.
        // FPS/slow-frame are sampled and gate on `stats.total > 0` in
        // addition to their own freshness/sample-count checks — frame
        // metrics start sampling the moment the bubble appears (often before
        // the host app has fired a single request), so without this a cold
        // start's own render jank shows as "4 slow" at 0 captured requests,
        // reading as the SDK reporting problems before anything happened.
        let hasSession = stats.total > 0
        let neutralColor = UIColor(red: 0xA7 / 255, green: 0xB1 / 255, blue: 0xBE / 255, alpha: 1)

        performanceLabel?.text = hasSession ? performanceStats.displayValue : "\u{2014}"
        performanceLabel?.textColor = hasSession ? performanceStats.displayColor : neutralColor
        performanceCaptionLabel?.textColor = (hasSession ? performanceStats.displayColor : neutralColor).withAlphaComponent(0.72)

        slowFrameLabel?.text = hasSession ? performanceStats.slowFrameValue : "\u{2014}"
        slowFrameLabel?.textColor = hasSession ? performanceStats.slowFrameColor : neutralColor
        slowFrameCaptionLabel?.textColor = (hasSession ? performanceStats.slowFrameColor : neutralColor).withAlphaComponent(0.72)

        networkLabel?.text = stats.networkValue
        networkLabel?.textColor = stats.networkColor
        networkCaptionLabel?.text = stats.networkCaption.lowercased()
        networkCaptionLabel?.textColor = stats.networkColor.withAlphaComponent(0.72)

        let newColor = stats.healthColor.withAlphaComponent(0.6).cgColor
        if ringLayer?.strokeColor != newColor {
            let colorAnim = CABasicAnimation(keyPath: "strokeColor")
            colorAnim.fromValue = ringLayer?.strokeColor
            colorAnim.toValue = newColor
            colorAnim.duration = 0.3
            ringLayer?.add(colorAnim, forKey: "color")
            ringLayer?.strokeColor = newColor
        }

        // Animate stroke progress to reflect success rate
        let rate: CGFloat = stats.total > 0 ? CGFloat(stats.success) / CGFloat(stats.total) : 0
        let progressAnim = CABasicAnimation(keyPath: "strokeEnd")
        progressAnim.fromValue = ringLayer?.presentation()?.strokeEnd ?? ringLayer?.strokeEnd ?? 0
        progressAnim.toValue = rate
        progressAnim.duration = 0.4
        progressAnim.timingFunction = CAMediaTimingFunction(name: .easeOut)
        ringLayer?.add(progressAnim, forKey: "progress")
        ringLayer?.strokeEnd = rate

        bubbleView?.accessibilityLabel = accessibilitySummary()
    }

    private func accessibilitySummary() -> String {
        let requestWord = stats.total == 1 ? "request" : "requests"
        let errorWord = stats.errors == 1 ? "error" : "errors"
        let networkText: String
        if stats.errors > 0 {
            networkText = "\(stats.errors) network \(errorWord)"
        } else if stats.networkValue == "--" {
            networkText = "95th percentile latency unavailable"
        } else {
            networkText = "95th percentile latency \(stats.spokenNetworkValue)"
        }
        // FPS/slow-frame speech mirrors the visible gating: no session yet
        // (0 captured requests) reads as "unavailable", not a frame count
        // sampled from before there was anything to measure against.
        let hasSession = stats.total > 0
        let fpsText = (!hasSession || performanceStats.displayValue == "--")
            ? "FPS unavailable"
            : "\(performanceStats.displayValue) FPS"
        let slowText = (!hasSession || performanceStats.slowFrameValue == "--")
            ? "slow frames unavailable"
            : "\(performanceStats.slowFrameValue) percent slow frames"
        return "Network monitor: \(stats.total) \(requestWord), \(networkText), \(fpsText), \(slowText)."
    }

    private func formatCompact(_ n: Int) -> String {
        if n < 1000 { return "\(n)" }
        if n < 10_000 { return String(format: "%.1fK", Double(n) / 1000) }
        return "\(n / 1000)K"
    }
}
#endif
