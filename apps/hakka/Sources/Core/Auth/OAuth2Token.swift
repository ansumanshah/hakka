import Foundation

/// A token obtained from a grant run, in memory only. The caller is
/// responsible for writing `accessToken`/`refreshToken`/`expiresAt` into the
/// environment's secret variables — this type never touches disk itself.
public struct OAuth2Token: Sendable, Equatable {
    public let accessToken: String
    public let refreshToken: String?
    public let expiresAt: Date?

    public init(accessToken: String, refreshToken: String? = nil, expiresAt: Date? = nil) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }

    /// True once `expiresAt` is within `skew` of `now` — including already
    /// past it. A token with no `expiresAt` (some client-credentials
    /// providers omit `expires_in`) is treated as never expiring; that
    /// matches the RFC, which makes `expires_in` optional.
    ///
    /// `skew` exists because "expired" has to mean *unsafe to start a
    /// request with*, not *expired at the server's clock the instant we
    /// check*: a token good for 3 more seconds can easily die mid-flight, or
    /// be judged already-dead by a server whose clock runs a little ahead of
    /// ours. Refreshing a few seconds early costs nothing; sending a request
    /// with a token that expires in transit costs a round trip and a retry.
    public func isExpired(now: Date = Date(), skew: TimeInterval = 30) -> Bool {
        guard let expiresAt else { return false }
        return now >= expiresAt.addingTimeInterval(-skew)
    }

    /// `expiresAt` computed from a token endpoint's `expires_in` (seconds),
    /// anchored to `issuedAt` rather than `Date()` so a slow token-endpoint
    /// round trip doesn't silently eat into the token's real lifetime.
    static func expiresAt(issuedAt: Date, expiresIn: Double?) -> Date? {
        guard let expiresIn else { return nil }
        return issuedAt.addingTimeInterval(expiresIn)
    }
}
