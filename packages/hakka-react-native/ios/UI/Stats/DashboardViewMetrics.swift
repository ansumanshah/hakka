// @generated — do not edit. Synced from ios/Sources/UI/Stats/DashboardViewMetrics.swift
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

// MARK: - DashboardView: Data
//
// Every computed metric the section files (Overview/Detail/Charts/Breakdowns)
// read, plus the small value types those computations return. Nothing here
// carries an access modifier — the section extensions live in sibling files
// and need to reach these, same trade documented on `DashboardView`'s stored
// properties.

extension DashboardView {
    var successCount: Int {
        requests.filter { ($0.status ?? 0) >= 200 && ($0.status ?? 0) < 400 }.count
    }

    var errorCount: Int {
        requests.filter { ($0.status ?? 0) >= 400 || $0.error != nil }.count
    }

    var uniqueHostCount: Int {
        Set(requests.compactMap { URL(string: $0.url)?.host }).count
    }

    /// HTTP status-class breakdown (2xx/3xx/4xx/5xx). Status 0/nil (pending/other) is excluded,
    /// matching web's `statusClass()` bucketing in StatsTab.tsx.
    var statusClassCounts: (twoXX: Int, threeXX: Int, fourXX: Int, fiveXX: Int) {
        var twoXX = 0, threeXX = 0, fourXX = 0, fiveXX = 0
        for req in requests {
            guard let status = req.status else { continue }
            switch status {
            case 200..<300: twoXX += 1
            case 300..<400: threeXX += 1
            case 400..<500: fourXX += 1
            case 500...: fiveXX += 1
            default: break
            }
        }
        return (twoXX, threeXX, fourXX, fiveXX)
    }

    var networkP95: Int64? {
        let durations = requests.compactMap(\.duration)
        guard !durations.isEmpty else { return nil }
        let sorted = durations.sorted()
        let index = Int(ceil(Double(sorted.count) * 0.95)) - 1
        let safeIndex = max(0, min(sorted.count - 1, index))
        return sorted[safeIndex]
    }

    var networkP95Text: String {
        guard let p95 = networkP95 else { return "--" }
        return Fmt.formatDuration(p95)
    }

    var networkCaption: String {
        errorCount > 0 ? "ERR" : "LAT"
    }

    var networkValue: String {
        errorCount > 0 ? "\(errorCount)" : networkP95Text
    }

    var sessionStatus: MonitorStatus {
        if requests.isEmpty {
            return MonitorStatus(
                title: "Ready to capture",
                subtitle: "Run a scenario to see traffic and performance signals.",
                icon: "dot.radiowaves.left.and.right",
                color: Theme.info
            )
        }
        if errorCount > 0 {
            return MonitorStatus(
                title: "\(errorCount) request \(errorCount == 1 ? "needs" : "need") attention",
                subtitle: "Failures are captured. Open details for domains, status, and slowest calls.",
                icon: "exclamationmark.triangle.fill",
                color: Theme.warning
            )
        }
        if (networkP95 ?? 0) > 900 {
            return MonitorStatus(
                title: "Capture healthy, latency is high",
                subtitle: "All requests succeeded, but the slowest path is visible in the trend chart.",
                icon: "speedometer",
                color: Theme.warning
            )
        }
        return MonitorStatus(
            title: "Capture healthy",
            subtitle: "Requests are succeeding and the UI is staying responsive.",
            icon: "checkmark.seal.fill",
            color: Theme.success
        )
    }

    var captureSummary: String {
        requests.isEmpty ? "Idle" : "\(requests.count) reqs"
    }

    var captureSummaryColor: Color {
        requests.isEmpty ? Theme.textTertiary : errorCount > 0 ? Theme.warning : Theme.success
    }

    var latencySummary: String {
        guard let networkP95 else { return "Waiting" }
        if networkP95 <= 300 { return "Fast" }
        if networkP95 <= 900 { return "Good" }
        return "Slow"
    }

    var latencySummaryColor: Color {
        performanceColor(networkP95)
    }

    var uiSummary: String {
        let frames = performanceMonitor.snapshot
        guard frames.isFresh, let slowFrameRate = frames.slowFrameRate else { return "Sampling" }
        if slowFrameRate <= 0.05 { return "Smooth" }
        if slowFrameRate <= 0.12 { return "Watch" }
        return "Slow"
    }

    var uiSummaryColor: Color {
        frameRateColor(performanceMonitor.snapshot)
    }

    var totalPayloadBytes: Int64 {
        requests.reduce(Int64(0)) { $0 + max(0, $1.requestBodySize) + max(0, $1.responseBodySize) }
    }

    var averagePayloadText: String {
        guard !requests.isEmpty else { return "--" }
        return Fmt.formatBytes(totalPayloadBytes / Int64(requests.count))
    }

    var requestRateText: String {
        let timestamps = requests.map(\.startTime).sorted()
        guard let first = timestamps.first, let last = timestamps.last else { return "--" }
        let spanMinutes = max(Double(last - first) / 60_000.0, 1.0 / 60.0)
        let rate = Double(requests.count) / spanMinutes
        if rate < 10 { return String(format: "%.1f", rate) }
        return String(format: "%.0f", rate)
    }

    func percentText(_ ratio: Double) -> String {
        String(format: "%.1f%%", ratio * 100)
    }

    func performanceColor(_ value: Int64?) -> Color {
        guard let p95 = value else { return Theme.textTertiary }
        if p95 <= 300 { return Theme.success }
        if p95 <= 900 { return Theme.warning }
        return Theme.error
    }

    func errorRateColor(_ value: Double) -> Color {
        if value >= 0.1 { return Theme.error }
        if value >= 0.05 { return Theme.warning }
        return Theme.success
    }

    func frameRateText(_ snapshot: HakkaUIPerformanceSnapshot) -> String {
        if let slowFrameRate = snapshot.slowFrameRate {
            return "\(percentText(slowFrameRate)) slow"
        }
        if let fps = snapshot.fps {
            return "\(Int(fps.rounded())) fps"
        }
        return "unavailable"
    }

    func frameFpsText(_ snapshot: HakkaUIPerformanceSnapshot) -> String {
        guard snapshot.isFresh, let fps = snapshot.fps else { return "--" }
        return "\(Int(fps.rounded()))"
    }

    func frameFpsColor(_ snapshot: HakkaUIPerformanceSnapshot) -> Color {
        guard snapshot.isFresh, let fps = snapshot.fps else { return Theme.textTertiary }
        let target = max(snapshot.refreshRateHz ?? 60, 1)
        let ratio = fps / target
        if ratio >= 0.90 { return Theme.success }
        if ratio >= 0.75 { return Theme.warning }
        return Theme.error
    }

    func frameJankText(_ snapshot: HakkaUIPerformanceSnapshot) -> String {
        guard snapshot.isFresh, let slowFrameRate = snapshot.slowFrameRate else { return "--" }
        return String(format: "%.0f%%", slowFrameRate * 100)
    }

    func frameRateColor(_ snapshot: HakkaUIPerformanceSnapshot) -> Color {
        guard snapshot.isFresh, let slowFrameRate = snapshot.slowFrameRate else {
            return Theme.textTertiary
        }
        if slowFrameRate <= 0.05 { return Theme.success }
        if slowFrameRate <= 0.12 { return Theme.warning }
        return Theme.error
    }

    func performanceCaption(from report: HealthReportRecord, frames: HakkaUIPerformanceSnapshot) -> String {
        let inFlight = Int(report.tags["component.capture.inFlightCount"] ?? "0") ?? 0
        let storageCount = Int(report.tags["component.storage.count"] ?? "") ?? 0
        let storageMax = Int(report.tags["component.storage.maxCount"] ?? "") ?? 0
        let captureStatus = report.tags["component.capture.status"] ?? "unknown"
        let frameText = frames.isFresh
            ? "Frozen frames \(frames.frozenFrameCount)"
            : "Frame sample unavailable"

        if storageMax > 0 {
            return "Storage \(storageCount)/\(storageMax) | \(frameText) | Capture \(captureStatus)"
        }
        return "\(frameText) | Capture \(captureStatus) | In-flight \(inFlight)"
    }

    struct MethodEntry { let method: String; let count: Int }
    struct LatencyPoint: Identifiable {
        let id: String
        let label: String
        let duration: Int64
    }
    struct PayloadPoint: Identifiable {
        let id: String
        let label: String
        let bytes: Int64
    }

    var latencyPoints: [LatencyPoint] {
        requests
            .suffix(18)
            .enumerated()
            .compactMap { index, request in
                guard let duration = request.duration else { return nil }
                let path = URL(string: request.url)?.path
                return LatencyPoint(
                    id: "\(request.id)-\(index)",
                    label: path?.isEmpty == false ? path! : request.method.rawValue,
                    duration: duration
                )
            }
    }

    var payloadPoints: [PayloadPoint] {
        requests
            .suffix(18)
            .enumerated()
            .map { index, request in
                let path = URL(string: request.url)?.path
                let bytes = max(0, request.requestBodySize) + max(0, request.responseBodySize)
                return PayloadPoint(
                    id: "\(request.id)-payload-\(index)",
                    label: path?.isEmpty == false ? path! : request.method.rawValue,
                    bytes: bytes
                )
            }
    }

    var methodCounts: [MethodEntry] {
        var counts: [String: Int] = [:]
        for req in requests { counts[req.method.rawValue, default: 0] += 1 }
        return counts.sorted { $0.value > $1.value }.map { MethodEntry(method: $0.key, count: $0.value) }
    }

    struct DomainEntry {
        let host: String; let count: Int; let avgMs: Int64; let errorCount: Int
    }
    var domainStats: [DomainEntry] {
        var groups: [String: [NetworkRequest]] = [:]
        for req in requests {
            let host = URL(string: req.url)?.host ?? "unknown"
            groups[host, default: []].append(req)
        }
        return groups.map { host, reqs in
            let durations = reqs.compactMap { $0.duration }
            let avg = durations.isEmpty ? Int64(0) : durations.reduce(0, +) / Int64(durations.count)
            let errs = reqs.filter { ($0.status ?? 0) >= 400 || $0.error != nil }.count
            return DomainEntry(host: host, count: reqs.count, avgMs: avg, errorCount: errs)
        }
        .sorted { $0.count > $1.count }
    }
}
#endif // canImport(UIKit)
