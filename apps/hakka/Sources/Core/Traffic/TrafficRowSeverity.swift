/// A traffic row's at-a-glance severity, rendered as the left-edge stripe.
/// Chili for failures — a transport error or a 5xx — turmeric for 4xx;
/// everything else carries no stripe. Failures outrank warnings: a request
/// that errored outright is chili even if a 4xx was seen mid-flight.
public enum TrafficRowSeverity: Sendable, Equatable {
    case error
    case warning

    public init?(status: Int?, transportError: Bool) {
        if transportError || (status ?? 0) >= 500 {
            self = .error
        } else if let status, (400..<500).contains(status) {
            self = .warning
        } else {
            return nil
        }
    }
}
