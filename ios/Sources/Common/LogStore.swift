import Foundation
import os

/// Thread-safe ring buffer for storing captured network requests.
/// O(1) add, O(1) lookup by ID.
public final class LogStore: @unchecked Sendable {
    private var buffer: [NetworkRequest?]
    private var index: [String: Int] // id -> position in buffer
    private var head: Int = 0
    private var _count: Int = 0
    private let capacity: Int
    private var minStartTime: Int64?
    private var minStartTimeNeedsRebuild = false
    private var metricsTotalRequests = 0
    private var metricsCompletedRequests = 0
    private var metricsSuccessCount = 0
    private var metricsErrorCount = 0
    private var metricsDurationTotalMs: Int64 = 0
    private var metricsDurationsById: [String: Int64] = [:]
    private var metricsP95LatencyMs: Int64?
    private var metricsP95NeedsRebuild = false
    private var metricsTotalDataTransferred: Int64 = 0
    private var lock = os_unfair_lock()

    /// Number of stored requests.
    public var count: Int {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return _count
    }

    /// All stored requests in insertion order (oldest first).
    public var requests: [NetworkRequest] {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return orderedRequests()
    }

    /// Create a new log store with the given capacity.
    public init(capacity: Int) {
        precondition(capacity > 0, "LogStore capacity must be positive")
        self.capacity = capacity
        self.buffer = Array(repeating: nil, count: capacity)
        self.index = Dictionary(minimumCapacity: capacity)
    }

    /// Add a request. If buffer is full, the oldest request is evicted.
    public func add(_ request: NetworkRequest) {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }

        // Evict old entry if overwriting
        if let existing = buffer[head] {
            index.removeValue(forKey: existing.id)
            removeMetrics(existing)
            if existing.startTime == minStartTime {
                minStartTime = nil
                minStartTimeNeedsRebuild = true
            }
        }

        buffer[head] = request
        index[request.id] = head
        addMetrics(request)
        if !minStartTimeNeedsRebuild {
            minStartTime = min(minStartTime ?? request.startTime, request.startTime)
        }
        head = (head + 1) % capacity
        if _count < capacity { _count += 1 }
    }

    /// Look up a request by ID. O(1).
    public func request(byId id: String) -> NetworkRequest? {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        guard let pos = index[id] else { return nil }
        return buffer[pos]
    }

    /// Mutate an existing log entry in-place by id.
    ///
    /// The `transform` closure is called while the lock is held, so keep it
    /// brief. Returns `false` when no entry with `id` exists.
    @discardableResult
    public func update(id: String, transform: (inout NetworkRequest) -> Void) -> Bool {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        guard let pos = index[id], var existing = buffer[pos] else { return false }
        removeMetrics(existing)
        transform(&existing)
        buffer[pos] = existing
        addMetrics(existing)
        return true
    }

    /// Query requests matching the given filter. Thread-safe.
    public func query(filter: RequestFilter) -> [NetworkRequest] {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return orderedRequests().filter { filter.matches($0) }
    }

    /// Remove all stored requests.
    public func clear() {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        buffer = Array(repeating: nil, count: capacity)
        index.removeAll(keepingCapacity: true)
        head = 0
        _count = 0
        minStartTime = nil
        minStartTimeNeedsRebuild = false
        resetMetrics()
    }

    /// Aggregate metrics for the current buffer without materializing bridge payloads.
    public func metricsSummary() -> NetworkMetricsSummary {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }

        if metricsP95NeedsRebuild {
            metricsP95LatencyMs = percentile(Array(metricsDurationsById.values), rank: 0.95)
            metricsP95NeedsRebuild = false
        }

        return NetworkMetricsSummary(
            totalRequests: metricsTotalRequests,
            completedRequests: metricsCompletedRequests,
            successCount: metricsSuccessCount,
            errorCount: metricsErrorCount,
            averageResponseTime: metricsDurationsById.isEmpty ? 0 : Double(metricsDurationTotalMs) / Double(metricsDurationsById.count),
            successRate: metricsTotalRequests == 0 ? 1.0 : Double(metricsSuccessCount) / Double(metricsTotalRequests),
            errorRate: metricsTotalRequests == 0 ? 0.0 : Double(metricsErrorCount) / Double(metricsTotalRequests),
            p95LatencyMs: metricsP95LatencyMs,
            totalDataTransferred: metricsTotalDataTransferred
        )
    }

    /// Returns whether at least one stored request is older than the given date.
    public func containsRequestOlderThan(_ epochMs: Int64) -> Bool {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        if minStartTimeNeedsRebuild {
            minStartTime = minimumStartTime()
            minStartTimeNeedsRebuild = false
        }
        guard let minStartTime else { return false }
        return minStartTime < epochMs
    }

    /// Returns the last `count` requests, newest first.
    public func recent(_ count: Int) -> [NetworkRequest] {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        let all = orderedRequests()
        return Array(all.suffix(min(count, all.count)).reversed())
    }

    /// Remove requests older than the given date (epoch ms).
    public func removeOlderThan(_ epochMs: Int64) {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }

        // Snapshot in insertion order before any mutation, then filter.
        // Calling orderedRequests() after partial nil-ification breaks the
        // ring-buffer traversal logic (_count would be stale and the start
        // position would land on a nil slot).
        let surviving = orderedRequests().filter { $0.startTime >= epochMs }

        buffer = Array(repeating: nil, count: capacity)
        index.removeAll(keepingCapacity: true)
        head = 0
        _count = 0
        minStartTime = nil
        minStartTimeNeedsRebuild = false
        resetMetrics()
        for req in surviving {
            buffer[head] = req
            index[req.id] = head
            addMetrics(req)
            minStartTime = min(minStartTime ?? req.startTime, req.startTime)
            head = (head + 1) % capacity
            _count += 1
        }
    }

    // Returns requests in insertion order (oldest first). Caller must hold lock.
    private func orderedRequests() -> [NetworkRequest] {
        guard _count > 0 else { return [] }
        var result = [NetworkRequest]()
        result.reserveCapacity(_count)
        let start = (_count < capacity) ? 0 : head
        for i in 0..<_count {
            let pos = (start + i) % capacity
            if let req = buffer[pos] {
                result.append(req)
            }
        }
        return result
    }

    private func minimumStartTime() -> Int64? {
        var minimum: Int64?
        for position in buffer.indices {
            guard let request = buffer[position] else { continue }
            minimum = min(minimum ?? request.startTime, request.startTime)
        }
        return minimum
    }

    private func addMetrics(_ request: NetworkRequest) {
        metricsTotalRequests += 1
        if let status = request.status, status > 0 {
            metricsCompletedRequests += 1
            if status >= 200 && status < 400 {
                metricsSuccessCount += 1
            }
        } else if request.error != nil {
            metricsCompletedRequests += 1
        }
        if request.error != nil || (request.status.map { $0 >= 400 } ?? false) {
            metricsErrorCount += 1
        }
        if let duration = request.duration {
            metricsDurationTotalMs += duration
            metricsDurationsById[request.id] = duration
            metricsP95NeedsRebuild = true
        }
        metricsTotalDataTransferred += request.responseBodySize
    }

    private func removeMetrics(_ request: NetworkRequest) {
        metricsTotalRequests -= 1
        if let status = request.status, status > 0 {
            metricsCompletedRequests -= 1
            if status >= 200 && status < 400 {
                metricsSuccessCount -= 1
            }
        } else if request.error != nil {
            metricsCompletedRequests -= 1
        }
        if request.error != nil || (request.status.map { $0 >= 400 } ?? false) {
            metricsErrorCount -= 1
        }
        if let duration = metricsDurationsById.removeValue(forKey: request.id) {
            metricsDurationTotalMs -= duration
            metricsP95NeedsRebuild = true
        }
        metricsTotalDataTransferred -= request.responseBodySize
    }

    private func resetMetrics() {
        metricsTotalRequests = 0
        metricsCompletedRequests = 0
        metricsSuccessCount = 0
        metricsErrorCount = 0
        metricsDurationTotalMs = 0
        metricsDurationsById.removeAll(keepingCapacity: true)
        metricsP95LatencyMs = nil
        metricsP95NeedsRebuild = false
        metricsTotalDataTransferred = 0
    }

    private func percentile(_ values: [Int64], rank: Double) -> Int64? {
        guard !values.isEmpty else { return nil }
        let sorted = values.sorted()
        let index = Int(ceil(Double(sorted.count) * rank)) - 1
        return sorted[max(0, min(sorted.count - 1, index))]
    }
}
