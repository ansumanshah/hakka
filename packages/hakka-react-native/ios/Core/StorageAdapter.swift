// @generated — do not edit. Synced from ios/Sources/Common/StorageAdapter.swift
// by scripts/sync-rn-ios.mjs. Edit the canonical source, then run `just sync-ios`.

import Foundation

/// Protocol for request storage backends.
/// Ships with InMemoryStorage (v1), designed for drop-in replacement by persistent storage in v1.1.
public protocol StorageAdapter: Sendable {
    /// Store a request.
    func store(_ request: NetworkRequest)

    /// Query requests matching the given filter.
    func query(filter: RequestFilter) -> [NetworkRequest]

    /// Remove all stored requests.
    func clear()

    /// Current number of stored requests.
    var count: Int { get }
}

/// Filter criteria for querying stored requests.
public struct RequestFilter: Sendable {
    public var urlPattern: String?
    public var method: String?
    public var statusRange: ClosedRange<Int>?
    public var since: Date?

    public init(
        urlPattern: String? = nil,
        method: String? = nil,
        statusRange: ClosedRange<Int>? = nil,
        since: Date? = nil
    ) {
        self.urlPattern = urlPattern
        self.method = method
        self.statusRange = statusRange
        self.since = since
    }

    /// Returns true if `request` satisfies all non-nil filter criteria.
    public func matches(_ request: NetworkRequest) -> Bool {
        if let pattern = urlPattern, !request.url.contains(pattern) { return false }
        if let m = method, request.method.rawValue != m { return false }
        if let range = statusRange {
            guard let status = request.status, range.contains(status) else { return false }
        }
        if let since = since {
            let sinceMs = Int64(since.timeIntervalSince1970 * 1000)
            if request.startTime < sinceMs { return false }
        }
        return true
    }
}

/// In-memory ring buffer storage implementing `StorageAdapter`.
/// Uses `LogStore` internally for the ring buffer + index.
public final class InMemoryStorage: StorageAdapter, @unchecked Sendable {
    private let logStore: LogStore

    public init(capacity: Int) {
        self.logStore = LogStore(capacity: capacity)
    }

    public func store(_ request: NetworkRequest) {
        logStore.add(request)
    }

    public func query(filter: RequestFilter) -> [NetworkRequest] {
        logStore.query(filter: filter)
    }

    public func clear() {
        logStore.clear()
    }

    public var count: Int {
        logStore.count
    }
}
