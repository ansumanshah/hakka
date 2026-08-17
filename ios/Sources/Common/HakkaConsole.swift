import Foundation
import os

// MARK: - ConsoleLevel

/// Severity level for a console log entry.
public enum ConsoleLevel: Int, Sendable, Comparable, CaseIterable {
    case debug = 0
    case info  = 1
    case warn  = 2
    case error = 3

    public static func < (lhs: ConsoleLevel, rhs: ConsoleLevel) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// Short display label.
    public var label: String {
        switch self {
        case .debug: return "DEBUG"
        case .info:  return "INFO"
        case .warn:  return "WARN"
        case .error: return "ERROR"
        }
    }
}

// MARK: - ConsoleEntry

/// A single captured log line.
public struct ConsoleEntry: Sendable, Identifiable {
    public let id: String
    public let level: ConsoleLevel
    public let message: String
    /// Epoch milliseconds (UTC).
    public let timestamp: Int64

    public init(id: String = UUID().uuidString,
                level: ConsoleLevel,
                message: String,
                timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) {
        self.id = id
        self.level = level
        self.message = message
        self.timestamp = timestamp
    }
}

// MARK: - HakkaConsole

/// Lightweight console sink. Captures entries pushed via the public API into
/// a bounded ring buffer (default 500). Entries pushed via ``log(_:_:)`` are
/// captured. Direct `print` / `NSLog` output is NOT captured (os_log is a
/// kernel-side facility and can't be intercepted without private API).
///
/// Usage:
/// ```swift
/// HakkaConsole.shared.log(.info, "User logged in")
/// HakkaConsole.shared.log(.error, "Request failed: \(error)")
/// ```
///
/// Optionally replace `print` in your code:
/// ```swift
/// func print(_ items: Any..., separator: String = " ", terminator: String = "\n") {
///     let msg = items.map { "\($0)" }.joined(separator: separator)
///     HakkaConsole.shared.log(.debug, msg)
///     Swift.print(msg, terminator: terminator)
/// }
/// ```
public final class HakkaConsole: @unchecked Sendable {

    // MARK: - Singleton

    public static let shared = HakkaConsole()

    // MARK: - Private state

    private var buffer: [ConsoleEntry?]
    private var head: Int = 0
    private var _count: Int = 0
    private let capacity: Int
    private var lock = os_unfair_lock()

    // Registered observers. Handlers are retained strongly until removed by id —
    // callers must not capture self strongly in a handler they never remove.
    private var observers: [(id: UUID, handler: @Sendable (ConsoleEntry) -> Void)] = []

    // MARK: - Init

    public init(capacity: Int = 500) {
        precondition(capacity > 0, "HakkaConsole capacity must be positive")
        self.capacity = capacity
        self.buffer = Array(repeating: nil, count: capacity)
    }

    // MARK: - Public API

    /// Append a log entry at the given level.
    public func log(_ level: ConsoleLevel, _ message: String) {
        let entry = ConsoleEntry(level: level, message: message)
        append(entry)
    }

    /// Convenience: append a debug message.
    public func debug(_ message: String) { log(.debug, message) }

    /// Convenience: append an info message.
    public func info(_ message: String) { log(.info, message) }

    /// Convenience: append a warning message.
    public func warn(_ message: String) { log(.warn, message) }

    /// Convenience: append an error message.
    public func error(_ message: String) { log(.error, message) }

    /// All captured entries in insertion order (oldest first), up to the buffer capacity.
    public var entries: [ConsoleEntry] {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return orderedEntries()
    }

    /// Number of entries currently in the buffer.
    public var count: Int {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return _count
    }

    /// Remove all entries.
    public func clear() {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        buffer = Array(repeating: nil, count: capacity)
        head = 0
        _count = 0
    }

    /// Register a handler called on every new entry (on the calling thread of `log`).
    /// Returns a token; cancel it to unregister.
    @discardableResult
    public func addObserver(_ handler: @Sendable @escaping (ConsoleEntry) -> Void) -> ConsoleObserverToken {
        let id = UUID()
        os_unfair_lock_lock(&lock)
        observers.append((id: id, handler: handler))
        os_unfair_lock_unlock(&lock)
        return ConsoleObserverToken(id: id, console: self)
    }

    // MARK: - Internal

    func removeObserver(id: UUID) {
        os_unfair_lock_lock(&lock)
        observers.removeAll { $0.id == id }
        os_unfair_lock_unlock(&lock)
    }

    private func append(_ entry: ConsoleEntry) {
        var snapshot: [(id: UUID, handler: @Sendable (ConsoleEntry) -> Void)]
        os_unfair_lock_lock(&lock)
        buffer[head] = entry
        head = (head + 1) % capacity
        if _count < capacity { _count += 1 }
        snapshot = observers
        os_unfair_lock_unlock(&lock)
        for obs in snapshot { obs.handler(entry) }
    }

    private func orderedEntries() -> [ConsoleEntry] {
        guard _count > 0 else { return [] }
        var result = [ConsoleEntry]()
        result.reserveCapacity(_count)
        let start = (_count < capacity) ? 0 : head
        for i in 0..<_count {
            let pos = (start + i) % capacity
            if let e = buffer[pos] { result.append(e) }
        }
        return result
    }
}

// MARK: - ConsoleObserverToken

/// Cancellable token returned by ``HakkaConsole/addObserver(_:)``.
public final class ConsoleObserverToken: @unchecked Sendable {
    private let id: UUID
    private weak var console: HakkaConsole?

    init(id: UUID, console: HakkaConsole) {
        self.id = id
        self.console = console
    }

    /// Unregister the observer.
    public func cancel() {
        console?.removeObserver(id: id)
    }

    deinit { cancel() }
}
