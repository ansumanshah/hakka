import Foundation
import HakkaCommon

/// No-op implementation of `HakkaInterceptor`.
///
/// Drop-in replacement for release builds. All methods are no-ops,
/// `isRunning` is always `false`, and no `URLProtocol` registration
/// or swizzling occurs.
public final class HakkaInterceptor: @unchecked Sendable {
    /// Shared singleton for convenience.
    public static let shared = HakkaInterceptor()

    /// Configuration.
    public let config: HakkaConfig

    /// In-memory log store (no-op).
    public let store: LogStore

    /// Dedicated structured-log ring buffer (no-op build still records entries
    /// locally — logging works even when network capture is disabled).
    public let logStore = HakkaLogStore()

    /// Retention policy (no-op).
    public let retentionPolicy: RetentionPolicy

    /// Delegate for receiving captured requests (never called).
    public weak var delegate: HakkaDelegate?

    /// Closure-based callback (never called).
    public var onRequest: HakkaRequestHandler?

    /// Whether interception is currently active. Always `false`.
    public private(set) var isRunning: Bool = false

    /// Whether capture is paused. Always `false` in the noop implementation.
    public private(set) var isPaused: Bool = false

    public init(config: HakkaConfig = .default) {
        self.config = config
        self.store = LogStore()
        self.retentionPolicy = RetentionPolicy(maxCount: config.maxRequests, maxAge: config.maxAge)
    }

    /// No-op.
    public func start() {}

    /// No-op.
    public func stop() {}

    /// No-op.
    public func pause() {}

    /// No-op.
    public func resume() {}

    /// No-op.
    public func clear() {}

    /// Returns the last `count` captured requests. Always empty.
    public func recentRequests(count: Int = 20) -> [NetworkRequest] { [] }

    /// Returns a snapshot of in-flight requests. Always empty.
    public func inFlightRequests() -> [NetworkRequest] { [] }

    /// Returns a subscription that can be cancelled. No delivery happens in noop.
    public func addSink(_ sink: @escaping RecordSink) -> SinkSubscription {
        SinkSubscription()
    }

    /// No-op.
    @discardableResult
    public func flushSinks(timeout: TimeInterval = 5) -> Bool { true }

    /// Always zero in noop.
    public func droppedSinkRecords() -> Int { 0 }

    /// No-op. The real interceptor emits the record to registered sinks.
    public func inject(_ record: any ContractRecord) {}

    /// Builds an inert health report with no captured records.
    public func healthReport(
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        sessionId: String? = nil,
        tags: [String: String] = [:]
    ) -> HealthReportRecord {
        var healthTags = tags
        healthTags["component.capture.inFlightCount"] = "0"
        healthTags["component.storage.count"] = "0"
        healthTags["component.storage.maxCount"] = String(config.maxRequests)
        healthTags["component.redaction.headerCount"] = String(config.redactHeaders.count)
        healthTags["component.redaction.queryItemCount"] = String(config.sensitiveQueryItems.count)
        healthTags["component.redaction.bodyFieldCount"] = String(config.sensitiveBodyFields.count)

        let redactionConfigured = !config.redactHeaders.isEmpty
            || !config.sensitiveQueryItems.isEmpty
            || !config.sensitiveBodyFields.isEmpty

        return HealthReportGenerator.generate(
            from: [],
            options: HealthReportBuildOptions(
                timestamp: timestamp,
                sessionId: sessionId,
                tags: healthTags,
                componentHealth: [
                    "capture": HealthComponentStatus(status: "disabled"),
                    "storage": HealthComponentStatus(status: "disabled"),
                    "redaction": HealthComponentStatus(status: redactionConfigured ? "configured" : "disabled"),
                    "sink": HealthComponentStatus(status: "disabled", droppedCount: 0),
                ]
            )
        )
    }

    /// No-op. In the real interceptor, this updates mutable config fields
    /// (keeping maxRequests fixed to the ring-buffer size).
    public func updateConfig(_ transform: (HakkaConfig) -> HakkaConfig) {}

    /// Returns an empty metrics summary. The noop interceptor captures nothing.
    public func networkMetricsSummary() -> NetworkMetricsSummary {
        NetworkMetricsSummary(
            totalRequests: 0, completedRequests: 0,
            successCount: 0, errorCount: 0,
            averageResponseTime: 0, successRate: 1.0, errorRate: 0,
            p95LatencyMs: nil, totalDataTransferred: 0
        )
    }

    // MARK: - Structured Logging

    /// Append a structured ``LogEntry`` to ``logStore``. Same API surface as the
    /// real interceptor — logging is never disabled by the network noop swap,
    /// since it doesn't depend on `URLProtocol` interception. Never throws.
    public func log(_ level: LogLevel, _ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        let redacted = metadata.map { config.redactMetadata($0) }
        let entry = LogEntry(level: level, message: message, category: category, metadata: redacted)
        logStore.add(entry)
    }

    /// Convenience: append a debug-level entry.
    public func logDebug(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.debug, message, category: category, metadata: metadata)
    }

    /// Convenience: append an info-level entry.
    public func logInfo(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.info, message, category: category, metadata: metadata)
    }

    /// Convenience: append a warn-level entry.
    public func logWarn(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.warn, message, category: category, metadata: metadata)
    }

    /// Convenience: append an error-level entry.
    public func logError(_ message: String, category: String? = nil, metadata: [String: String]? = nil) {
        log(.error, message, category: category, metadata: metadata)
    }
}

public typealias HakkaDelegate = HakkaCommon.HakkaDelegate
public typealias HakkaRequestHandler = HakkaCommon.HakkaRequestHandler
