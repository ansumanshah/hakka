/// Pure layout plan for the timing waterfall: the five contract phases as
/// proportional bars plus the degradation states a record can land in. No
/// SwiftUI dependency so the states and fractions are unit-testable.
public struct TimingWaterfallPlan: Sendable, Equatable {
    public enum State: Sendable, Equatable {
        /// All/most phases measured — bars scale against the phase sum.
        case phases
        /// First byte measured but no connection phases — the socket was
        /// reused or the layer can't split them. Bars still render.
        case reusedConnection
        /// No phases at all — one full-width total bar from the duration.
        case totalOnly
    }

    public struct Row: Sendable, Equatable, Identifiable {
        public let label: String
        public let ms: Int64?
        /// Bar width as a share of the phase sum, 0...1. Zero for absent or
        /// when the sum itself is zero.
        public let fraction: Double
        /// Where the bar starts on the shared timeline, as a share of the
        /// phase sum, 0...1 — the cumulative duration of every phase before
        /// this one. `URLSessionTaskMetrics` hands the SDK only durations
        /// (see `TransportPhases`), not phase start timestamps, so this is
        /// derived as a running total over the fixed DNS→TCP→TLS→TTFB→
        /// Download order rather than read off real offsets. A phase absent
        /// from the record contributes zero to the running total, so the
        /// next phase's bar starts exactly where the last measured one
        /// ended — the reused-connection state (no DNS/TCP/TLS) puts TTFB at
        /// offset zero rather than leaving a false gap.
        public let offsetFraction: Double
        public var id: String { label }
    }

    public let state: State
    public let rows: [Row]
    /// The denominator the fractions were computed against: the phase sum
    /// when phases exist, else the record's duration.
    public let totalMs: Int64
    /// A state explanation shown under the bars, or nil.
    public let note: String?

    public init(
        dnsMs: Int64?,
        tlsMs: Int64?,
        connectMs: Int64?,
        ttfbMs: Int64?,
        downloadMs: Int64?,
        durationMs: Int64?
    ) {
        let present = [dnsMs, connectMs, tlsMs, ttfbMs, downloadMs].compactMap { $0 }
        let phaseSum = present.reduce(0, +)
        totalMs = phaseSum > 0 ? phaseSum : (durationMs ?? 0)

        let hasTtfb = ttfbMs != nil
        let hasConnectionPhase = dnsMs != nil || connectMs != nil || tlsMs != nil
        let noPhases = present.isEmpty

        if noPhases {
            state = .totalOnly
            note = "No per-phase timing captured for this request."
            rows = [Row(label: "Total", ms: durationMs, fraction: (durationMs ?? 0) > 0 ? 1 : 0, offsetFraction: 0)]
            return
        }

        if hasTtfb && !hasConnectionPhase {
            state = .reusedConnection
            note = "Connection reused or phases not measurable at this layer"
        } else {
            state = .phases
            note = nil
        }

        // Cumulative running total in the fixed DNS→TCP→TLS→TTFB→Download
        // order — see `Row.offsetFraction`'s doc comment for why this is a
        // derived offset, not a measured one.
        var cumulativeMs: Int64 = 0
        func bar(_ label: String, _ ms: Int64?) -> Row {
            let offsetFraction: Double = phaseSum > 0 ? Double(cumulativeMs) / Double(phaseSum) : 0
            let fraction: Double = {
                guard let ms, phaseSum > 0 else { return 0 }
                return min(1, Double(ms) / Double(phaseSum))
            }()
            if let ms { cumulativeMs += ms }
            return Row(label: label, ms: ms, fraction: fraction, offsetFraction: offsetFraction)
        }
        rows = [
            bar("DNS", dnsMs),
            bar("TCP", connectMs),
            bar("TLS", tlsMs),
            bar("TTFB", ttfbMs),
            bar("Download", downloadMs),
        ]
    }
}
