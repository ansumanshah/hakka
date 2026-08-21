import Foundation

/// A request a script can read and mutate. Plain, JSON-safe data — no host
/// objects cross into JavaScript. Mirrors the shape a pre-request hook will
/// eventually receive (ADR 0010 phase 4.2); nothing here is wired into the
/// request pipeline yet — that wiring, the collection file format, and a
/// script editor are explicitly out of scope for the contract landed here.
public struct ScriptRequestContext: Sendable, Equatable {
    public var method: String
    public var url: String
    public var headers: [String: String]
    public var body: String?

    public init(method: String, url: String, headers: [String: String] = [:], body: String? = nil) {
        self.method = method
        self.url = url
        self.headers = headers
        self.body = body
    }
}

/// A response a script can read and mutate, for a post-response hook.
public struct ScriptResponseContext: Sendable, Equatable {
    public var status: Int
    public var headers: [String: String]
    public var body: String?

    public init(status: Int, headers: [String: String] = [:], body: String? = nil) {
        self.status = status
        self.headers = headers
        self.body = body
    }
}
