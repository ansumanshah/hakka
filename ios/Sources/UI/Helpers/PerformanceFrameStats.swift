#if canImport(UIKit)
import Foundation
import HakkaPerformance

// MARK: - PerformanceFrameStats

/// Shared frame-metric aggregation model. Accumulates `FrameMetricRecord`
/// samples into fps/slow-frame/frozen-frame counters — shared by the
/// floating bubble (`BubbleWindow`) and the embedded Monitor dashboard
/// (`DashboardView`) so both use identical freshness and minimum-sample
/// rules instead of duplicating them.
struct PerformanceFrameStats {
    private let minimumFrameSamples = 30

    var fps: Double?
    var refreshRateHz: Double?
    var frameCount = 0
    var slowFrameCount = 0
    var frozenFrameCount = 0
    var lastUpdated: Date?

    /// Samples go stale after 3s — both consumers show "--"/neutral color
    /// once the performance session has stopped emitting.
    var isFresh: Bool {
        guard let lastUpdated else { return false }
        return Date().timeIntervalSince(lastUpdated) < 3.0
    }

    /// Withheld until `minimumFrameSamples` frames have accumulated, so a
    /// handful of samples right after start doesn't read as a definitive rate.
    var slowFrameRate: Double? {
        guard frameCount >= minimumFrameSamples else { return nil }
        return Double(slowFrameCount) / Double(frameCount)
    }

    /// Sendable snapshot for SwiftUI consumers (`DashboardPerformanceMonitor`).
    var snapshot: HakkaUIPerformanceSnapshot {
        HakkaUIPerformanceSnapshot(
            fps: fps,
            refreshRateHz: refreshRateHz,
            slowFrameRate: slowFrameRate,
            frozenFrameCount: frozenFrameCount,
            isFresh: isFresh
        )
    }

    mutating func record(frame: FrameMetricRecord) {
        let sampledFrames = max(Int(frame.tags["frameCount"] ?? "") ?? 0, 0)
        let sampledSlowFrames = max(Int(frame.tags["jankFrameCount"] ?? "") ?? 0, 0)
        let sampledFrozenFrames = max(Int(frame.tags["frozenFrameCount"] ?? "") ?? 0, 0)

        if sampledFrames > 0 {
            frameCount += sampledFrames
            slowFrameCount += min(sampledSlowFrames, sampledFrames)
            frozenFrameCount += min(sampledFrozenFrames, sampledFrames)
        } else {
            frameCount += 1
            if frame.slow { slowFrameCount += 1 }
            if frame.frozen { frozenFrameCount += 1 }
        }
        fps = frame.tags["fps"].flatMap(Double.init)
        refreshRateHz = frame.refreshRateHz
        lastUpdated = Date()
    }
}
#endif
