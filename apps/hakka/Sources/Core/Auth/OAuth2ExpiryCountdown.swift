import Foundation

/// Pure minutes-remaining math for the Auth tab's "expires in NN min"
/// countdown — no `Date()`/SwiftUI dependency baked in, so the boundary
/// rounding is unit-testable against synthetic clocks rather than the
/// wall clock.
public enum OAuth2ExpiryCountdown: Sendable, Equatable {
    /// Minutes remaining, rounded up so "expires in 1 min" never reads as
    /// "expires now" while there's still time left on the clock.
    case minutes(Int)
    /// `expiresAt` is at or before `now`.
    case expired

    public init(expiresAt: Date, now: Date) {
        let remainingSeconds = expiresAt.timeIntervalSince(now)
        guard remainingSeconds > 0 else {
            self = .expired
            return
        }
        self = .minutes(Int((remainingSeconds / 60).rounded(.up)))
    }

    /// "expires in 58 min" / "expired", the exact copy from the design.
    public var displayText: String {
        switch self {
        case let .minutes(count): "expires in \(count) min"
        case .expired: "expired"
        }
    }
}
