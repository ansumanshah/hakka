import Foundation
import HakkaCommon

/// No-op log store. All mutations are discarded, all queries return empty results.
public final class LogStore: @unchecked Sendable {
    /// Number of stored requests. Always 0.
    public var count: Int { 0 }

    /// All stored requests. Always empty.
    public var requests: [NetworkRequest] { [] }

    public init(capacity: Int = 500) {}

    /// No-op.
    public func add(_ request: NetworkRequest) {}

    /// Look up a request by ID. Always `nil`.
    public func request(byId id: String) -> NetworkRequest? { nil }

    /// No-op. Always returns `false` — the noop store holds no entries to mutate.
    @discardableResult
    public func update(id: String, transform: (inout NetworkRequest) -> Void) -> Bool { false }

    /// Query requests matching the given filter. Always empty.
    public func query(filter: RequestFilter) -> [NetworkRequest] { [] }

    /// No-op.
    public func clear() {}

    /// Returns the last `count` requests. Always empty.
    public func recent(_ count: Int) -> [NetworkRequest] { [] }

    /// No-op.
    public func removeOlderThan(_ epochMs: Int64) {}

    /// Returns an empty metrics summary. The noop store holds no requests.
    public func metricsSummary() -> NetworkMetricsSummary {
        NetworkMetricsSummary(
            totalRequests: 0, completedRequests: 0,
            successCount: 0, errorCount: 0,
            averageResponseTime: 0, successRate: 1.0, errorRate: 0,
            p95LatencyMs: nil, totalDataTransferred: 0
        )
    }

    /// Always `false` — the noop store holds no requests.
    public func containsRequestOlderThan(_ epochMs: Int64) -> Bool { false }
}
