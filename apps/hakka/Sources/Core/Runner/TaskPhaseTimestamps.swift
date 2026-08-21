import Foundation

/// The phase timestamps one URL-session transaction reports, extracted from
/// `URLSessionTaskMetrics` so phase math is testable against synthetic
/// values — no live session needed.
public struct TaskPhaseTimestamps: Sendable, Equatable {
    public var domainLookupStart: Date?
    public var domainLookupEnd: Date?
    public var connectStart: Date?
    public var connectEnd: Date?
    public var secureConnectionStart: Date?
    public var requestEnd: Date?
    public var responseStart: Date?
    public var responseEnd: Date?

    public init(
        domainLookupStart: Date? = nil,
        domainLookupEnd: Date? = nil,
        connectStart: Date? = nil,
        connectEnd: Date? = nil,
        secureConnectionStart: Date? = nil,
        requestEnd: Date? = nil,
        responseStart: Date? = nil,
        responseEnd: Date? = nil
    ) {
        self.domainLookupStart = domainLookupStart
        self.domainLookupEnd = domainLookupEnd
        self.connectStart = connectStart
        self.connectEnd = connectEnd
        self.secureConnectionStart = secureConnectionStart
        self.requestEnd = requestEnd
        self.responseStart = responseStart
        self.responseEnd = responseEnd
    }

    public init(transaction: URLSessionTaskTransactionMetrics) {
        domainLookupStart = transaction.domainLookupStartDate
        domainLookupEnd = transaction.domainLookupEndDate
        connectStart = transaction.connectStartDate
        connectEnd = transaction.connectEndDate
        secureConnectionStart = transaction.secureConnectionStartDate
        requestEnd = transaction.requestEndDate
        responseStart = transaction.responseStartDate
        responseEnd = transaction.responseEndDate
    }

    /// The task's aggregated phases: each transaction's timestamps become
    /// phases, then phases are summed — a request redirected through three
    /// hops shows the whole journey.
    public static func phases(from metrics: URLSessionTaskMetrics) -> TransportPhases {
        let perTransaction = metrics.transactionMetrics.map { TransportPhases(from: TaskPhaseTimestamps(transaction: $0)) }
        return TransportPhases.summing(perTransaction)
    }
}
