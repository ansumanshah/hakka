import Foundation

/// One gRPC metadata entry — the wire equivalent of an HTTP header, sent at
/// the start of the call (request metadata / response initial metadata) or
/// the end (response trailing metadata, which is where `grpc-status`/
/// `grpc-message` live). A plain name/value pair rather than reusing
/// `HeaderPair`: metadata has no `enabled` flag by the time it reaches the
/// transport (`GrpcRunner` already filtered/resolved it), and binary
/// (`-bin`-suffixed) values are out of scope for phase 1.
public struct GrpcMetadataEntry: Sendable, Equatable {
    public let name: String
    public let value: String

    public init(name: String, value: String) {
        self.name = name
        self.value = value
    }
}

/// One unary gRPC call, already resolved (target, metadata, and message are
/// all final — no `{{variable}}` left to interpolate, no auth to apply).
public struct GrpcUnaryRequest: Sendable {
    public let target: GrpcTarget
    public let metadata: [GrpcMetadataEntry]
    /// Raw, unframed protobuf message bytes — `GrpcTransport` conformers add
    /// gRPC's own wire framing (or hand it to a library that does), the
    /// same division of labor `RequestTransport` has with `URLRequest.httpBody`.
    public let message: Data
    /// Seconds; `nil` uses the transport's own default.
    public let timeout: TimeInterval?

    public init(target: GrpcTarget, metadata: [GrpcMetadataEntry], message: Data, timeout: TimeInterval?) {
        self.target = target
        self.metadata = metadata
        self.message = message
        self.timeout = timeout
    }
}

/// The outcome of one unary gRPC call. Unlike `TransportResponse`, this
/// always carries a gRPC status — `statusCode`/`statusMessage` — because
/// gRPC's real outcome is never absent the way an HTTP status can be
/// "pending": either the call reached the server and got a status (0 for
/// OK, non-zero otherwise), or it never reached the server, which a
/// conformer reports as `.unavailable` (14), gRPC's own canonical code for
/// "could not complete the call" — never by throwing, so `GrpcRunner` has
/// exactly one outcome shape to build a record from, matching how
/// `RequestRunner` folds every transport failure into `record.error` rather
/// than special-casing "before" vs "after" the wire.
public struct GrpcUnaryResponse: Sendable {
    public let initialMetadata: [GrpcMetadataEntry]
    /// `nil` when the call failed before a message was ever received
    /// (including a pre-flight failure — `statusCode != 0` explains why).
    public let message: Data?
    public let trailingMetadata: [GrpcMetadataEntry]
    /// A `GrpcStatusCode.rawValue` — 0 is OK.
    public let statusCode: Int
    public let statusMessage: String?

    public init(
        initialMetadata: [GrpcMetadataEntry],
        message: Data?,
        trailingMetadata: [GrpcMetadataEntry],
        statusCode: Int,
        statusMessage: String?,
    ) {
        self.initialMetadata = initialMetadata
        self.message = message
        self.trailingMetadata = trailingMetadata
        self.statusCode = statusCode
        self.statusMessage = statusMessage
    }
}

/// Sends one gRPC unary call and reports what happened. Protocol-based so
/// tests inject a stub that never touches the network — the same seam
/// `RequestTransport`/`WebSocketTransport` provide for their protocols
/// (ADR 0010 sub-decision 4: "new send paths are transports").
/// `GRPCSwiftUnaryTransport` is the real implementation.
///
/// Streaming (server/client/bidi) is explicitly out of scope for phase 1 —
/// this protocol has exactly one method on purpose. Phase 2 adds a sibling
/// method or protocol rather than growing this one, the same way
/// `WebSocketTransport` stayed connection-shaped instead of trying to also
/// model unary sends.
public protocol GrpcTransport: Sendable {
    /// Throws only for a failure before any RPC could even be attempted
    /// (e.g. the target couldn't be constructed) — a connection or RPC
    /// failure once the attempt starts is reported via the returned
    /// response's `statusCode`, never thrown. See `GrpcUnaryResponse`'s docs.
    func unary(_ request: GrpcUnaryRequest) async throws -> GrpcUnaryResponse
}
