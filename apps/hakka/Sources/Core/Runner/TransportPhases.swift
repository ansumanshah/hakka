import Foundation

/// The five non-overlapping wire phases the record contract carries, as
/// measured for one send. Field names mirror `NetworkRequest`'s timing
/// fields so the runner populates them without translation.
public struct TransportPhases: Sendable, Equatable {
    public let dnsMs: Int64?
    public let tlsMs: Int64?
    public let connectMs: Int64?
    public let ttfbMs: Int64?
    public let downloadMs: Int64?

    public init(
        dnsMs: Int64? = nil,
        tlsMs: Int64? = nil,
        connectMs: Int64? = nil,
        ttfbMs: Int64? = nil,
        downloadMs: Int64? = nil
    ) {
        self.dnsMs = dnsMs
        self.tlsMs = tlsMs
        self.connectMs = connectMs
        self.ttfbMs = ttfbMs
        self.downloadMs = downloadMs
    }

    public var isEmpty: Bool {
        dnsMs == nil && tlsMs == nil && connectMs == nil && ttfbMs == nil && downloadMs == nil
    }

    /// One send's phases from its phase timestamps. The TLS window is carved
    /// out of the connect window so the three connection phases never
    /// overlap — the five values then sum to the send's total, which is what
    /// the timing view scales its bars against. Absent endpoints leave the
    /// phase nil (a reused connection reports no DNS/TCP/TLS at all).
    public init(from timestamps: TaskPhaseTimestamps) {
        dnsMs = Self.diffMs(from: timestamps.domainLookupStart, to: timestamps.domainLookupEnd)
        tlsMs = Self.diffMs(from: timestamps.secureConnectionStart, to: timestamps.connectEnd)
        if let connectStart = timestamps.connectStart, let connectEnd = timestamps.connectEnd {
            let wholeMs = Self.diffMs(from: connectStart, to: connectEnd) ?? 0
            connectMs = tlsMs.map { wholeMs - $0 } ?? wholeMs
        } else {
            connectMs = nil
        }
        let lastPreResponse = [
            timestamps.requestEnd,
            timestamps.connectEnd,
            timestamps.domainLookupEnd,
        ]
        .compactMap { $0 }
        .max()
        ttfbMs = Self.diffMs(from: lastPreResponse, to: timestamps.responseStart)
        downloadMs = Self.diffMs(from: timestamps.responseStart, to: timestamps.responseEnd)
    }

    /// Sums per-phase values across a send's transactions (redirect hops); a
    /// phase absent from every transaction stays nil.
    public static func summing(_ phases: [TransportPhases]) -> TransportPhases {
        func sum(_ value: (TransportPhases) -> Int64?) -> Int64? {
            let present = phases.compactMap(value)
            return present.isEmpty ? nil : present.reduce(0, +)
        }
        return TransportPhases(
            dnsMs: sum(\.dnsMs),
            tlsMs: sum(\.tlsMs),
            connectMs: sum(\.connectMs),
            ttfbMs: sum(\.ttfbMs),
            downloadMs: sum(\.downloadMs)
        )
    }

    private static func diffMs(from start: Date?, to end: Date?) -> Int64? {
        guard let start, let end else { return nil }
        // Round, not truncate: sub-second intervals arrive as 9.999…ms.
        return max(0, Int64((end.timeIntervalSince(start) * 1000).rounded()))
    }
}
