import HakkaCommon

/// Derived metrics over a `TrafficStore` buffer at a point in time. Every
/// field here is read straight from `TrafficStatsAccumulator`'s running
/// state — producing a snapshot never re-scans or re-sorts the buffer.
public struct TrafficStats: Sendable, Equatable {
    public let count: Int
    public let errorCount: Int
    public let p50DurationMs: Int64?
    public let p95DurationMs: Int64?
    public let totalBytes: Int64

    public var errorRate: Double {
        count == 0 ? 0 : Double(errorCount) / Double(count)
    }

    public init(count: Int, errorCount: Int, p50DurationMs: Int64?, p95DurationMs: Int64?, totalBytes: Int64) {
        self.count = count
        self.errorCount = errorCount
        self.p50DurationMs = p50DurationMs
        self.p95DurationMs = p95DurationMs
        self.totalBytes = totalBytes
    }
}

/// Running totals plus a sorted-by-insertion duration list, so `snapshot()`
/// is O(1)/O(log n) index reads rather than a sort-on-read. `sortedDurations`
/// is kept sorted via binary-search insert/remove on every `insert`/`remove`
/// call (O(log n) to locate the slot, O(n) to shift — acceptable at the
/// buffer's ~thousands-of-entries scale, and still strictly incremental:
/// nothing here re-sorts or re-scans the full set on read).
struct TrafficStatsAccumulator {
    private(set) var count = 0
    private(set) var errorCount = 0
    private(set) var totalBytes: Int64 = 0
    private var sortedDurations: [Int64] = []

    mutating func insert(_ request: NetworkRequest) {
        count += 1
        if Self.isError(request) { errorCount += 1 }
        totalBytes += request.requestBodySize + request.responseBodySize
        if let duration = request.duration {
            sortedDurations.insertSorted(duration)
        }
    }

    mutating func remove(_ request: NetworkRequest) {
        count -= 1
        if Self.isError(request) { errorCount -= 1 }
        totalBytes -= request.requestBodySize + request.responseBodySize
        if let duration = request.duration {
            sortedDurations.removeSorted(duration)
        }
    }

    func snapshot() -> TrafficStats {
        TrafficStats(
            count: count,
            errorCount: errorCount,
            p50DurationMs: percentile(0.5),
            p95DurationMs: percentile(0.95),
            totalBytes: totalBytes
        )
    }

    /// Nearest-rank percentile — same formula `LogStore.percentile` in
    /// `ios/Sources/Common/LogStore.swift` uses, kept consistent on purpose.
    private func percentile(_ rank: Double) -> Int64? {
        guard !sortedDurations.isEmpty else { return nil }
        let index = Int((Double(sortedDurations.count) * rank).rounded(.up)) - 1
        return sortedDurations[max(0, min(sortedDurations.count - 1, index))]
    }

    static func isError(_ request: NetworkRequest) -> Bool {
        request.error != nil || (request.status.map { $0 >= 400 } ?? false)
    }
}

private extension Array where Element == Int64 {
    mutating func insertSorted(_ value: Int64) {
        insert(value, at: lowerBound(of: value))
    }

    /// Removes one occurrence of `value`. A no-op if it isn't present (should
    /// not happen for a value this array itself inserted, but guards against
    /// insert/remove call-site drift rather than crashing).
    mutating func removeSorted(_ value: Int64) {
        let index = lowerBound(of: value)
        guard index < count, self[index] == value else { return }
        remove(at: index)
    }

    private func lowerBound(of value: Int64) -> Int {
        var lo = 0
        var hi = count
        while lo < hi {
            let mid = (lo + hi) / 2
            if self[mid] < value { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }
}
