import Foundation

/// Enforces retention rules (max count and max age) on a `LogStore`.
public struct RetentionPolicy: Sendable {
    /// Maximum number of requests to keep.
    public let maxCount: Int
    /// Maximum age in seconds. Requests older than this are purged. `nil` means no age limit.
    public let maxAge: TimeInterval?

    public init(maxCount: Int = 500, maxAge: TimeInterval? = nil) {
        self.maxCount = maxCount
        self.maxAge = maxAge
    }

    /// Apply this policy to the given store, removing expired entries.
    public func enforce(on store: LogStore) {
        guard let maxAge = maxAge else { return }
        let cutoff = Int64(Date().timeIntervalSince1970 * 1000) - Int64(maxAge * 1000)
        guard store.containsRequestOlderThan(cutoff) else { return }
        store.removeOlderThan(cutoff)
    }
}
