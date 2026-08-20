import HakkaCommon

/// Bounded in-memory capture buffer for desktop traffic inspection.
///
/// `append` is O(1) amortized — `RingBuffer` overwrites in place, no element
/// shifting. `stats()` reads `TrafficStatsAccumulator`'s running state, which
/// is updated on every `append`/eviction, so a stats read never scans the
/// buffer. `query`/`all`/`request(id:)` are the only O(n) operations, and
/// only because their result genuinely is "every matching element."
public actor TrafficStore {
    public static let defaultCapacity = 5000

    private var buffer: RingBuffer<NetworkRequest>
    private var accumulator = TrafficStatsAccumulator()

    public init(capacity: Int = TrafficStore.defaultCapacity) {
        buffer = RingBuffer(capacity: capacity)
    }

    public var capacity: Int { buffer.capacity }
    public var count: Int { buffer.count }

    public func append(_ request: NetworkRequest) {
        if let evicted = buffer.append(request) {
            accumulator.remove(evicted)
        }
        accumulator.insert(request)
    }

    public func append(contentsOf requests: [NetworkRequest]) {
        for request in requests { append(request) }
    }

    public func clear() {
        buffer.removeAll()
        accumulator = TrafficStatsAccumulator()
    }

    /// All buffered requests, oldest first.
    public func all() -> [NetworkRequest] { buffer.elements }

    public func request(id: String) -> NetworkRequest? {
        buffer.elements.first { $0.id == id }
    }

    public func stats() -> TrafficStats { accumulator.snapshot() }

    /// Requests matching `query`, sorted per `query.sort`/`query.order` when
    /// set, otherwise in buffer order (oldest first).
    public func query(_ query: TrafficQuery) -> [NetworkRequest] {
        let predicate = TrafficQueryCompiler.compile(query)
        let filtered = buffer.elements.filter(predicate)
        guard let field = query.sort else { return filtered }
        return TrafficSort.sort(filtered, field: field, order: query.order)
    }
}
