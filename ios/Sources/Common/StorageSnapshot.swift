import Foundation

/// A named device-storage snapshot (`UserDefaults`, redacted keychain,
/// cookies, ...) streamed over the bridge.
///
/// Mirrors `StorageSnapshot` in `packages/hakka-core/src/model/types.ts`
/// field-for-field: `store` (free-form name), `timestamp` (epoch millis),
/// `entries` (`[String: String]`, the native mirror of the JS
/// `Record<string, string>`). `store` is free-form so each runtime can name
/// its own stores (e.g. `"defaults"`, `"keychain-redacted"`, `"cookies"`);
/// the desktop UI groups panels by it.
///
/// Snapshot-replace semantics: a new snapshot for the same `store` replaces
/// its prior contents wholesale — this is never a diff. `entries` is always
/// already redacted upstream (e.g. via `HakkaConfig.redactMetadata`) before
/// a snapshot is built, matching ``LogEntry/metadata``'s "already redacted"
/// contract.
public struct StorageSnapshot: Sendable, Codable, Equatable {
    public let store: String
    /// Epoch milliseconds this snapshot was captured.
    public let timestamp: Int64
    public let entries: [String: String]

    public init(
        store: String,
        timestamp: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
        entries: [String: String]
    ) {
        self.store = store
        self.timestamp = timestamp
        self.entries = entries
    }
}
