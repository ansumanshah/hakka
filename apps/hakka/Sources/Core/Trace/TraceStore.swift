import HakkaCommon

/// One trace's accumulated requests + spans, keyed by trace id
/// (`correlationId` on requests, `traceId` on spans).
public struct Trace: Sendable, Equatable {
    public let id: String
    public internal(set) var requests: [NetworkRequest] = []
    public internal(set) var spans: [FrameworkSpan] = []

    /// Distinct `runtime`s contributing to this trace — the signal the UI
    /// affordance gates on (see `TraceStore` doc). A single-runtime trace
    /// (one client hop, no server capture attached) is not worth a
    /// cross-target waterfall.
    public var participantRuntimes: Set<RequestRuntime> {
        var runtimes = Set(requests.map { $0.runtime ?? .client })
        runtimes.formUnion(spans.map(\.runtime))
        return runtimes
    }

    public var isMultiTarget: Bool { participantRuntimes.count > 1 }

    public func tree(verbose: Bool = false) -> TraceTree {
        TraceTree.assemble(requests: requests, spans: spans, verbose: verbose)
    }
}

/// Correlates requests and spans into traces for the cross-target waterfall
/// — the desktop counterpart to `hakka-mcp`'s `SpanStore` +
/// `hakka-browser`'s `groupBy: 'trace'` request grouping, since the desktop
/// has neither and has to build both sides of the join itself.
///
/// **Renderable vs. abandoned.** A trace becomes renderable the moment it
/// holds ANY content — one request, or one span with no request yet (a
/// span can legitimately arrive first: the server's capture and the bridge
/// relay race the client's own frame). There is no "wait until complete"
/// gate: this is a streaming dev-loop tool where a request is routinely
/// still in flight, so "complete" isn't a meaningful precondition — the
/// waterfall (`TraceTree.assemble`) already renders a partial bar list
/// correctly (a pending request has no `endTime`/`duration`; a span is
/// only ever emitted on end, per `hakka-node`'s `SpanProcessor`, so a
/// present span is always complete).
///
/// A trace is considered "abandoned" the moment it stops being the most
/// recently touched — this store is a bounded, capacity-limited map with
/// LRU-by-touch eviction, the same discipline `TrafficStore` uses for
/// requests (a ring buffer, no wall-clock timer). There is no separate
/// "abandoned" state to observe: an evicted trace is simply gone, exactly
/// like an evicted request falling out of `TrafficStore`. This avoids
/// standing up a timer actor to age out a trace whose owning target
/// disconnected — the store self-bounds by capacity instead, which is
/// simpler and matches the one bounding mechanism already established in
/// this codebase.
public actor TraceStore {
    public static let defaultCapacity = 500

    private var order: [String] = [] // trace ids, oldest-touched first
    private var traces: [String: Trace] = [:]
    private let capacity: Int

    public init(capacity: Int = TraceStore.defaultCapacity) {
        self.capacity = capacity
    }

    public var count: Int { traces.count }

    public func addRequest(_ request: NetworkRequest) {
        guard let traceID = request.correlationId else { return }
        var trace = traces[traceID] ?? Trace(id: traceID)
        trace.requests.append(request)
        touch(traceID, with: trace)
    }

    public func addSpan(_ span: FrameworkSpan) {
        var trace = traces[span.traceId] ?? Trace(id: span.traceId)
        trace.spans.append(span)
        touch(span.traceId, with: trace)
    }

    public func trace(id: String) -> Trace? { traces[id] }

    /// The trace a given request belongs to, if any — the lookup the "open
    /// waterfall" affordance needs from a traffic row or detail pane.
    public func trace(forRequestID requestID: String) -> Trace? {
        traces.values.first { trace in trace.requests.contains { $0.id == requestID } }
    }

    public func clear() {
        order.removeAll()
        traces.removeAll()
    }

    /// Moves `id` to most-recently-touched and evicts the oldest trace when
    /// over capacity. A trace already in `order` is repositioned rather than
    /// duplicated.
    private func touch(_ id: String, with trace: Trace) {
        traces[id] = trace
        if let existingIndex = order.firstIndex(of: id) {
            order.remove(at: existingIndex)
        }
        order.append(id)
        while order.count > capacity {
            let evicted = order.removeFirst()
            traces.removeValue(forKey: evicted)
        }
    }
}
