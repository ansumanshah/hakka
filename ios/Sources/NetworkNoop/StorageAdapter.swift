import Foundation
import HakkaCommon

public typealias StorageAdapter = HakkaCommon.StorageAdapter
public typealias RequestFilter = HakkaCommon.RequestFilter

/// No-op in-memory storage implementing `StorageAdapter`.
public final class InMemoryStorage: StorageAdapter, @unchecked Sendable {
    public init(capacity: Int = 500) {}

    /// No-op.
    public func store(_ request: NetworkRequest) {}

    /// Always empty.
    public func query(filter: RequestFilter) -> [NetworkRequest] { [] }

    /// No-op.
    public func clear() {}

    /// Always 0.
    public var count: Int { 0 }
}
