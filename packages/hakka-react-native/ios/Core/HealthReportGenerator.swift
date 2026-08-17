// @generated — do not edit. Synced from ios/Sources/Common/HealthReportGenerator.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Optional health state for a named native component.
///
/// These details are emitted as tags under the `component.*` namespace and can
/// represent capture/sink/storage/redaction/collector health without tying common
/// code to platform-specific modules.
public struct HealthComponentStatus: Sendable, Equatable {
    public let status: String?
    public let droppedCount: Int64?

    public init(status: String? = nil, droppedCount: Int64? = nil) {
        self.status = status
        self.droppedCount = droppedCount
    }
}

/// Inputs for common health report generation.
public struct HealthReportBuildOptions: Sendable {
    public let timestamp: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let componentHealth: [String: HealthComponentStatus]

    public init(
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        sessionId: String? = nil,
        tags: [String: String] = [:],
        componentHealth: [String: HealthComponentStatus] = [:]
    ) {
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.tags = tags
        self.componentHealth = componentHealth
    }
}

/// Builds a consolidated `HealthReportRecord` from contract records.
public enum HealthReportGenerator {
    /// Aggregate health metrics from network and frame contract records.
    public static func generate(
        from records: [any ContractRecord],
        options: HealthReportBuildOptions = HealthReportBuildOptions()
    ) -> HealthReportRecord {
        let networkRecords = records.compactMap { $0 as? NetworkRecord }
        let frameRecords = records.compactMap { $0 as? FrameMetricRecord }

        let totalRequests = networkRecords.count
        let errorCount = networkRecords.filter { isError($0) }.count
        let errorRate = totalRequests > 0 ? Double(errorCount) / Double(totalRequests) : 0

        let frozenFrameCount = frameRecords.isEmpty ? nil : frameRecords.reduce(into: 0) { sum, frame in
            if frame.frozen { sum += 1 }
        }
        let slowFrameRate = frameRecords.isEmpty ? nil : Double(frameRecords.filter(\.slow).count) / Double(frameRecords.count)

        let allTimestamps = networkRecords.map(\.timestamp) + frameRecords.map(\.timestamp)
        let windowStart = allTimestamps.min() ?? options.timestamp
        let windowEnd = allTimestamps.max() ?? options.timestamp
        let tags = mergedTags(base: options.tags, components: options.componentHealth)
        let summary = summary(
            totalRequests: totalRequests,
            errorRate: errorRate,
            slowFrameRate: slowFrameRate,
            frozenFrameCount: frozenFrameCount,
            componentHealth: options.componentHealth,
        )

        return HealthReportRecord(
            id: "health-\(UUID().uuidString)",
            timestamp: options.timestamp,
            sessionId: options.sessionId,
            tags: tags,
            windowStart: windowStart,
            windowEnd: windowEnd,
            totalRequests: totalRequests,
            errorRate: errorRate,
            slowFrameRate: slowFrameRate,
            frozenFrameCount: frozenFrameCount,
            summary: summary,
        )
    }

    private static func isError(_ requestRecord: NetworkRecord) -> Bool {
        requestRecord.request.error != nil || (requestRecord.request.status ?? 0) >= 400
    }

    private static func mergedTags(
        base: [String: String],
        components: [String: HealthComponentStatus],
    ) -> [String: String] {
        var merged = base
        for (name, health) in components {
            let componentPrefix = "component.\(name)"
            if let status = health.status {
                merged["\(componentPrefix).status"] = status
            }
            if let droppedCount = health.droppedCount {
                merged["\(componentPrefix).droppedCount"] = String(droppedCount)
            }
        }
        return merged
    }

    private static func summary(
        totalRequests: Int,
        errorRate: Double,
        slowFrameRate: Double?,
        frozenFrameCount: Int?,
        componentHealth: [String: HealthComponentStatus],
    ) -> String? {
        guard !componentHealth.isEmpty else { return nil }

        let componentSummary = componentHealth
            .keys
            .sorted()
            .compactMap { name in
                let health = componentHealth[name]
                var parts: [String] = []
                if let status = health?.status { parts.append(status) }
                if let droppedCount = health?.droppedCount {
                    parts.append("dropped=\(droppedCount)")
                }
                let detail = parts.joined(separator: " ")
                return detail.isEmpty ? nil : "\(name)=\(detail)"
            }

        var details = "requests=\(totalRequests) errorRate=\(formatRate(errorRate))"
        if let slowFrameRate {
            details += " slowFrameRate=\(formatRate(slowFrameRate))"
        }
        if let frozenFrameCount {
            details += " frozenFrames=\(frozenFrameCount)"
        }
        if !componentSummary.isEmpty {
            details += " components=[\(componentSummary.joined(separator: ", "))]"
        }
        return details
    }

    private static func formatRate(_ value: Double) -> String {
        String(format: "%.4f", locale: Locale(identifier: "en_US_POSIX"), value)
    }
}
