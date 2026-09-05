// @generated — do not edit. Synced from ios/Sources/UI/Stats/DashboardSupportTypes.swift
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

// MARK: - DashboardView support types
//
// Value/observable types `DashboardView` depends on but that aren't part of
// its own stored state — split out of `DashboardView.swift` alongside the
// section extensions. `MonitorStatus` carries no access modifier so
// `DashboardViewMetrics.swift`'s `sessionStatus` can construct it.

struct MonitorStatus {
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
}

@MainActor
final class DashboardPerformanceMonitor: ObservableObject {
    @Published private(set) var snapshot = HakkaUIPerformanceSnapshot(
        fps: nil,
        refreshRateHz: nil,
        slowFrameRate: nil,
        frozenFrameCount: 0,
        isFresh: false
    )
    @Published private(set) var resourceSnapshot = DashboardResourceSnapshot()

    private var stats = PerformanceFrameStats()
    private var performance: HakkaPerformance?
    private var subscription: SinkSubscription?

    func start() {
        guard performance == nil else { return }

        let perf = HakkaPerformance { builder in
            builder.sampleIntervalMs = 1000
            builder.tags = ["surface": "hakka-ui-monitor"]
            builder.enableFrameMetrics = true
            builder.enableMemoryMetrics = true
            builder.enableCpuMetrics = true
            builder.enableNetworkUsageMetrics = false
        }
        subscription = perf.addSink { record in
            Task { @MainActor in
                self.handle(record)
            }
        }
        performance = perf
        perf.start()
    }

    func stop() {
        subscription?.cancel()
        subscription = nil
        performance?.close()
        performance = nil
        stats = PerformanceFrameStats()
        snapshot = stats.snapshot
        resourceSnapshot = DashboardResourceSnapshot()
    }

    private func handle(_ record: any ContractRecord) {
        switch record {
        case let frame as FrameMetricRecord:
            stats.record(frame: frame)
            snapshot = stats.snapshot
        case let memory as MemoryMetricRecord:
            resourceSnapshot.heapUsedBytes = memory.heapUsedBytes
            resourceSnapshot.heapMaxBytes = memory.heapMaxBytes
        case let cpu as CpuMetricRecord:
            resourceSnapshot.processCpuPercent = cpu.processCpuPercent
        default:
            break
        }
    }
}

/// Snapshot of memory/CPU cards on the Monitor dashboard. Mirrors Android's
/// `MemoryMetricSnapshot`/`CpuMetricSnapshot` display formatting in StatsActivity.kt.
struct DashboardResourceSnapshot {
    var heapUsedBytes: Int64?
    var heapMaxBytes: Int64?
    var processCpuPercent: Double?

    var memoryDisplay: String {
        guard let used = heapUsedBytes else { return "--" }
        if let max = heapMaxBytes, max > 0 {
            return "\(Fmt.formatBytes(used))/\(Fmt.formatBytes(max))"
        }
        return Fmt.formatBytes(used)
    }

    var cpuDisplay: String {
        guard let percent = processCpuPercent else { return "--" }
        return String(format: "%.0f%%", max(0, percent))
    }
}
#endif // canImport(UIKit)
