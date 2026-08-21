import Foundation

/// Canonical gRPC status codes carried by the `grpc-status` trailer.
/// https://grpc.io/docs/guides/status-codes/ — the real outcome of a gRPC
/// call, independent of the HTTP status (a failed call is usually HTTP 200).
public enum GrpcStatusCode: Int, Sendable, Equatable, CaseIterable {
    case ok = 0
    case cancelled = 1
    case unknown = 2
    case invalidArgument = 3
    case deadlineExceeded = 4
    case notFound = 5
    case alreadyExists = 6
    case permissionDenied = 7
    case resourceExhausted = 8
    case failedPrecondition = 9
    case aborted = 10
    case outOfRange = 11
    case unimplemented = 12
    case internalError = 13
    case unavailable = 14
    case dataLoss = 15
    case unauthenticated = 16

    public var name: String {
        switch self {
        case .ok: "OK"
        case .cancelled: "CANCELLED"
        case .unknown: "UNKNOWN"
        case .invalidArgument: "INVALID_ARGUMENT"
        case .deadlineExceeded: "DEADLINE_EXCEEDED"
        case .notFound: "NOT_FOUND"
        case .alreadyExists: "ALREADY_EXISTS"
        case .permissionDenied: "PERMISSION_DENIED"
        case .resourceExhausted: "RESOURCE_EXHAUSTED"
        case .failedPrecondition: "FAILED_PRECONDITION"
        case .aborted: "ABORTED"
        case .outOfRange: "OUT_OF_RANGE"
        case .unimplemented: "UNIMPLEMENTED"
        case .internalError: "INTERNAL"
        case .unavailable: "UNAVAILABLE"
        case .dataLoss: "DATA_LOSS"
        case .unauthenticated: "UNAUTHENTICATED"
        }
    }

    public var isOK: Bool { self == .ok }
}

/// Where a resolved gRPC status was actually observed — the viewer must
/// never claim a status it did not really see on the wire.
public enum GrpcStatusSource: Sendable, Equatable {
    /// Parsed from the gRPC-Web trailer pseudo-frame embedded in the body.
    case grpcWebTrailerFrame
    /// Parsed from a `grpc-status` response header — a "Trailers-Only"
    /// HTTP/2 response, where the call failed before any message was sent
    /// and the server folds the trailer into the sole HEADERS frame.
    case trailersOnlyResponseHeader
}

/// The resolved gRPC outcome for one call. `GrpcDecodedBody.status == nil`
/// means no trailer was captured at all; callers must say so plainly rather
/// than inferring success from an HTTP 200.
public struct GrpcStatus: Sendable, Equatable {
    public let code: Int
    public let message: String?
    public let source: GrpcStatusSource

    public init(code: Int, message: String?, source: GrpcStatusSource) {
        self.code = code
        self.message = message
        self.source = source
    }

    /// The canonical code this maps to, or `nil` for a non-standard value.
    public var known: GrpcStatusCode? { GrpcStatusCode(rawValue: code) }
}

/// Parses `grpc-status`/`grpc-message` out of gRPC-Web's trailer frame text
/// — plain `Key: value\r\n` lines per the gRPC-Web wire spec (formatted like
/// HTTP headers, but carried inside the body, not real headers).
enum GrpcTrailerParser {
    static func parse(_ text: String) -> (code: Int, message: String?)? {
        var code: Int?
        var message: String?
        for rawLine in text.split(whereSeparator: { $0 == "\r\n" || $0 == "\n" }) {
            guard let colon = rawLine.firstIndex(of: ":") else { continue }
            let key = rawLine[rawLine.startIndex..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = rawLine[rawLine.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if key == "grpc-status" { code = Int(value) }
            if key == "grpc-message" { message = (value.removingPercentEncoding ?? value) }
        }
        guard let code else { return nil }
        return (code, (message?.isEmpty == false) ? message : nil)
    }
}
