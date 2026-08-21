import HakkaCommon

/// Swift mirror of `FrameworkSpan` in
/// `packages/hakka-core/src/model/types.ts` — a Next.js/OTel framework span
/// (`hakka-node`'s request tree). Additive record kind, never mixed into
/// `[NetworkRequest]`; joined to a request trace group only by
/// `traceId == correlationId` equality (see `NetworkRequest.correlationId`).
/// Do not add fields here without a matching TS field — this type only
/// exists to decode what `hakka-node` already emits on the wire.
public struct FrameworkSpan: Sendable, Identifiable, Codable, Equatable {
    public let id: String
    public let traceId: String
    /// `nil` for a root span — either genuinely rootless, or an orphan whose
    /// parent span never arrived (see `TraceTree.assemble`'s depth walk,
    /// which treats an unresolvable `parentId` the same as `nil`).
    public let parentId: String?
    public let name: String
    /// Epoch milliseconds, as captured on the emitting target's own clock —
    /// see `TraceTree.assemble` for how cross-target skew is handled.
    public let startTime: Int64
    public let endTime: Int64
    /// String-only attribute bag, matching TS `Attributes` exactly (never a
    /// richer JSON value — `hakka-node` never emits one).
    public let attrs: [String: String]?
    public let verbosity: SpanVerbosity
    public let runtime: RequestRuntime
    public let requestKind: SpanRequestKind?

    public init(
        id: String,
        traceId: String,
        parentId: String? = nil,
        name: String,
        startTime: Int64,
        endTime: Int64,
        attrs: [String: String]? = nil,
        verbosity: SpanVerbosity,
        runtime: RequestRuntime,
        requestKind: SpanRequestKind? = nil
    ) {
        self.id = id
        self.traceId = traceId
        self.parentId = parentId
        self.name = name
        self.startTime = startTime
        self.endTime = endTime
        self.attrs = attrs
        self.verbosity = verbosity
        self.runtime = runtime
        self.requestKind = requestKind
    }
}

/// Mirrors the TS union literal `'primary' | 'verbose'` on `FrameworkSpan`.
@frozen public enum SpanVerbosity: String, Sendable, Codable {
    case primary
    case verbose
}

/// Mirrors the TS `RequestKind` union — how an inbound Next.js request
/// originated. Lives on `FrameworkSpan`, not `NetworkRequest`.
@frozen public enum SpanRequestKind: String, Sendable, Codable {
    case document
    case rsc
    case routeHandler = "route-handler"
    case serverAction = "server-action"
}
