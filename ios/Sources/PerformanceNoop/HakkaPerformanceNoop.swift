import Foundation
import HakkaCommon

/// No-op mirror config for `HakkaPerformance` parity.
public struct HakkaPerformanceConfig: Sendable {
    public let sampleIntervalMs: Int64
    public let sessionId: String?
    public let tags: [String: String]
    public let enableFrameMetrics: Bool
    public let enableMemoryMetrics: Bool
    public let enableCpuMetrics: Bool
    public let enableNetworkUsageMetrics: Bool

    public init(
        sampleIntervalMs: Int64 = 1000,
        sessionId: String? = nil,
        tags: [String: String] = [:],
        enableFrameMetrics: Bool = true,
        enableMemoryMetrics: Bool = true,
        enableCpuMetrics: Bool = true,
        enableNetworkUsageMetrics: Bool = false,
    ) {
        self.sampleIntervalMs = sampleIntervalMs
        self.sessionId = sessionId
        self.tags = tags
        self.enableFrameMetrics = enableFrameMetrics
        self.enableMemoryMetrics = enableMemoryMetrics
        self.enableCpuMetrics = enableCpuMetrics
        self.enableNetworkUsageMetrics = enableNetworkUsageMetrics
    }

    public func withProductionDefaults() -> Self {
        HakkaPerformanceConfig(
            sampleIntervalMs: sampleIntervalMs >= 1000 ? sampleIntervalMs : 1000,
            sessionId: sessionId,
            tags: tags,
            enableFrameMetrics: enableFrameMetrics,
            enableMemoryMetrics: enableMemoryMetrics,
            enableCpuMetrics: enableCpuMetrics,
            enableNetworkUsageMetrics: enableNetworkUsageMetrics
        )
    }
}

/// No-op performance shim.
public final class HakkaPerformance: @unchecked Sendable {
    /// `false` here, `true` in the real module — lets callers detect which variant is linked.
    public static let isAvailable = false
    private let config: HakkaPerformanceConfig
    private let sinks = RecordSinkHub()

    /// Marker used by host integrations to detect this flavor.
    public private(set) var isRunning: Bool = false

    public init(_ build: (Builder) -> Void = { _ in }) {
        let builder = Builder()
        build(builder)
        config = builder.config.withProductionDefaults()
        for sink in builder.configuredSinks {
            _ = sinks.add(sink)
        }
    }

    public func start() {}

    public func stop() {
        isRunning = false
    }

    public func close() {
        stop()
    }

    public func addSink(_ sink: @escaping RecordSink) -> SinkSubscription {
        sinks.add(sink)
    }

    public func sampleIntervalMs() -> Int64 {
        config.sampleIntervalMs
    }

    @discardableResult
    public func flushSinks(timeoutMs: Int64 = 5_000) -> Bool {
        return sinks.flush(timeout: TimeInterval(max(0, timeoutMs)) / 1000.0)
    }

    public func droppedSinkRecords() -> Int {
        sinks.droppedCount()
    }

    public func healthReport(
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        sessionId: String? = nil,
        tags: [String: String] = [:]
    ) -> HealthReportRecord {
        var reportTags = config.tags
        for (key, value) in tags {
            reportTags[key] = value
        }
        reportTags["component.collector.sampleIntervalMs"] = String(config.sampleIntervalMs)

        return HealthReportGenerator.generate(
            from: [],
            options: HealthReportBuildOptions(
                timestamp: timestamp,
                sessionId: sessionId ?? config.sessionId,
                tags: reportTags,
                componentHealth: [
                    "collector.frame": HealthComponentStatus(status: "disabled"),
                    "collector.memory": HealthComponentStatus(status: "disabled"),
                    "collector.cpu": HealthComponentStatus(status: "disabled"),
                    "collector.networkUsage": HealthComponentStatus(status: "disabled"),
                    "sink": HealthComponentStatus(status: "ok", droppedCount: 0),
                ]
            )
        )
    }

    /// Fluent builder for no-op performance with matching shape.
    public final class Builder {
        public init() {}

        public var sampleIntervalMs: Int64 = 1000
        public var sessionId: String?
        public var tags: [String: String] = [:]
        public var enableFrameMetrics: Bool = true
        public var enableMemoryMetrics: Bool = true
        public var enableCpuMetrics: Bool = true
        public var enableNetworkUsageMetrics: Bool = false

        var config: HakkaPerformanceConfig {
            HakkaPerformanceConfig(
                sampleIntervalMs: sampleIntervalMs,
                sessionId: sessionId,
                tags: tags,
                enableFrameMetrics: enableFrameMetrics,
                enableMemoryMetrics: enableMemoryMetrics,
                enableCpuMetrics: enableCpuMetrics,
                enableNetworkUsageMetrics: enableNetworkUsageMetrics
            )
        }

        public func sink(_ sink: @escaping RecordSink) -> Builder {
            configuredSinks.append(sink)
            return self
        }

        var configuredSinks: [RecordSink] = []
    }
}

/// Lets consumers detect the noop product explicitly by name.
public enum HakkaPerformanceNoop {
    public static let isAvailable = false
}
