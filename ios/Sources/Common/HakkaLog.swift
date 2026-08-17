import Foundation
import os

// MARK: - LogLevel

/// Severity level for a structured ``LogEntry``.
///
/// Mirrors `packages/hakka-core/src/log/types.ts` `LogLevel` field-for-field
/// (`debug | info | warn | error`) so native and JS logs share one shape.
public enum LogLevel: String, Sendable, CaseIterable, Codable {
    case debug
    case info
    case warn
    case error

    /// Short display label, uppercased for badges.
    public var label: String {
        rawValue.uppercased()
    }
}

// MARK: - LogEntry

/// A single structured log record.
///
/// Mirrors `packages/hakka-core/src/log/types.ts` `LogEntry` field-for-field:
/// `id` (string), `timestamp` (epoch millis), `level`, `message`, `category?`,
/// `metadata?`. `metadata` is typed `[String: String]` — the native mirror of
/// the JS `Record<string, unknown>` — matching the `[String: String]` tag
/// convention used elsewhere in this package (``FrameMetricRecord``,
/// ``HealthReportRecord``, etc).
public struct LogEntry: Sendable, Identifiable, Codable, Equatable {
    public let id: String
    /// Epoch milliseconds (UTC).
    public let timestamp: Int64
    public let level: LogLevel
    public let message: String
    /// Subsystem tag, e.g. "auth", "payments".
    public let category: String?
    /// Structured fields (redaction-aware — see `HakkaInterceptor.log(...)`).
    public let metadata: [String: String]?

    public init(
        id: String = "log_\(UUID().uuidString)",
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        level: LogLevel,
        message: String,
        category: String? = nil,
        metadata: [String: String]? = nil
    ) {
        self.id = id
        self.timestamp = timestamp
        self.level = level
        self.message = message
        self.category = category
        self.metadata = metadata
    }
}

// MARK: - LogStore

/// Fixed-size ring buffer of ``LogEntry`` records, dedicated to structured
/// logging. Distinct from the network-capture `LogStore` in `LogStore.swift`
/// (that one holds `NetworkRequest` records) — this store never mixes the two.
///
/// Mirrors `packages/hakka-core/src/log/LogStore.ts`: O(1) `add`, oldest-evicted-first
/// once capacity is reached, `getEntries()` oldest→newest, `subscribe`/`clear`/`size`.
public final class HakkaLogStore: @unchecked Sendable {
    private var buffer: [LogEntry?]
    private var head: Int = 0
    private var _size: Int = 0
    private let capacity: Int
    private var lock = os_unfair_lock()
    private var listeners: [UUID: @Sendable (LogEntry) -> Void] = [:]

    /// Create a new structured log store. Default capacity matches core (500).
    public init(capacity: Int = 500) {
        precondition(capacity > 0, "HakkaLogStore capacity must be positive")
        self.capacity = capacity
        self.buffer = Array(repeating: nil, count: capacity)
    }

    /// Append an entry. Evicts the oldest entry once the buffer is full.
    public func add(_ entry: LogEntry) {
        var snapshot: [@Sendable (LogEntry) -> Void] = []
        os_unfair_lock_lock(&lock)
        buffer[head] = entry
        head = (head + 1) % capacity
        if _size < capacity { _size += 1 }
        snapshot = Array(listeners.values)
        os_unfair_lock_unlock(&lock)

        for listener in snapshot {
            listener(entry)
        }
    }

    /// All stored entries in insertion order (oldest first).
    public func getEntries() -> [LogEntry] {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return orderedEntries()
    }

    /// Remove all entries.
    public func clear() {
        os_unfair_lock_lock(&lock)
        buffer = Array(repeating: nil, count: capacity)
        head = 0
        _size = 0
        os_unfair_lock_unlock(&lock)
    }

    /// Register a listener called on every new entry. Returns a token —
    /// call ``HakkaLogSubscription/unsubscribe()`` (or let it deinit) to stop delivery.
    @discardableResult
    public func subscribe(_ listener: @escaping @Sendable (LogEntry) -> Void) -> HakkaLogSubscription {
        let id = UUID()
        os_unfair_lock_lock(&lock)
        listeners[id] = listener
        os_unfair_lock_unlock(&lock)
        return HakkaLogSubscription(id: id, store: self)
    }

    /// Number of entries currently in the buffer.
    public func size() -> Int {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return _size
    }

    func removeListener(id: UUID) {
        os_unfair_lock_lock(&lock)
        listeners.removeValue(forKey: id)
        os_unfair_lock_unlock(&lock)
    }

    private func orderedEntries() -> [LogEntry] {
        guard _size > 0 else { return [] }
        var result = [LogEntry]()
        result.reserveCapacity(_size)
        let start = (_size < capacity) ? 0 : head
        for i in 0..<_size {
            let pos = (start + i) % capacity
            if let entry = buffer[pos] { result.append(entry) }
        }
        return result
    }
}

// MARK: - HakkaLogSubscription

/// Cancellable token returned by ``HakkaLogStore/subscribe(_:)``.
public final class HakkaLogSubscription: @unchecked Sendable {
    private let id: UUID
    private weak var store: HakkaLogStore?

    init(id: UUID, store: HakkaLogStore) {
        self.id = id
        self.store = store
    }

    /// Unregister the listener.
    public func unsubscribe() {
        store?.removeListener(id: id)
    }

    deinit { unsubscribe() }
}
