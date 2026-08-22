import Foundation

/// Whether a `RequestSpec.url` (possibly still carrying unresolved
/// `{{variable}}` placeholders) names a gRPC endpoint. A prefix check rather
/// than `URL(string:)` because the host/path may not resolve yet — the
/// scheme alone is enough to decide which editor/detail path the request
/// gets, the same reasoning `WebSocketURL.isWebSocketURL` uses.
public enum GrpcURL {
    public static func isGrpcURL(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.hasPrefix("grpc://") || trimmed.hasPrefix("grpcs://")
    }
}

/// A resolved gRPC call target, parsed from an already-interpolated
/// `grpc://`/`grpcs://` URL: `grpc://host:port/package.Service/Method`
/// (`grpcs://` for TLS). The path is exactly the string gRPC itself puts on
/// the HTTP/2 `:path` pseudo-header, so this is a plain URL split, not a
/// gRPC-specific parser — see ADR 0012's "target + method path ride the
/// URL" decision for why `RequestSpec` gained no separate service/method
/// fields.
public struct GrpcTarget: Sendable, Equatable {
    public let host: String
    public let port: Int
    public let useTLS: Bool
    /// Fully qualified service name, e.g. `"myapp.UserService"`.
    public let service: String
    public let method: String

    /// `nil` when `url` isn't a `grpc(s)://` URL, has no host, or its path
    /// isn't exactly two segments (`/Service/Method`) — a malformed target
    /// is refused here rather than producing a `GrpcUnaryRequest` that could
    /// only fail later, mirroring `RequestResolutionError.invalidURL`'s
    /// refuse-before-send discipline.
    public init?(url: URL) {
        guard let scheme = url.scheme?.lowercased(), scheme == "grpc" || scheme == "grpcs" else { return nil }
        guard let host = url.host, !host.isEmpty else { return nil }
        let segments = url.path.split(separator: "/", omittingEmptySubsequences: true)
        guard segments.count == 2 else { return nil }

        self.host = host
        // 50051 is the gRPC ecosystem's conventional local-dev port
        // (grpcurl, grpcui, most quickstarts default to it); 443 for TLS
        // matches every other HTTPS-shaped default in this app.
        self.port = url.port ?? (scheme == "grpcs" ? 443 : 50051)
        self.useTLS = scheme == "grpcs"
        self.service = String(segments[0])
        self.method = String(segments[1])
    }

    public init(host: String, port: Int, useTLS: Bool, service: String, method: String) {
        self.host = host
        self.port = port
        self.useTLS = useTLS
        self.service = service
        self.method = method
    }
}
