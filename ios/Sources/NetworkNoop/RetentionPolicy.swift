import Foundation

/// No-op retention policy kept for compatibility with the non-network implementation.
public final class RetentionPolicy: Sendable {
    public let maxCount: Int
    public let maxAge: TimeInterval?

    public init(maxCount: Int = 500, maxAge: TimeInterval? = nil) {
        self.maxCount = maxCount
        self.maxAge = maxAge
    }

    /// No-op retention policy.
    public func enforce(on store: LogStore) {}
}
