import Foundation
import HakkaCommon

/// How one request in a folder run landed. Distinct from `RunResult`'s
/// pass/fail-per-assertion shape because a folder run summary needs one
/// headline state per row, and that state has an outcome `RunResult` alone
/// can't express: a request that never reached the wire at all
/// (`resolutionFailed`) versus one that did but errored in flight
/// (`requestFailed`) versus one that sent and got a response but failed its
/// own assertions (`assertionsFailed`).
public enum FolderRunItemStatus: Sendable, Equatable {
    case passed
    case assertionsFailed(failedCount: Int)
    /// The request reached the wire but the transport reported an error
    /// (`NetworkRequest.error`) — DNS failure, timeout, connection refused.
    case requestFailed(String)
    /// The request never reached the wire — a missing `{{variable}}`, a bad
    /// URL, or an unencodable body (`RequestRunnerError`).
    case resolutionFailed(String)

    public var isFailure: Bool {
        if case .passed = self { false } else { true }
    }
}

/// One row of a folder run's summary — the per-request detail the sidebar's
/// run affordance shows: name, status, duration, and which assertions
/// passed or failed.
public struct FolderRunItem: Sendable, Equatable, Identifiable {
    public let id: String
    public let requestId: String
    public let name: String
    public let method: HttpMethod
    public let status: FolderRunItemStatus
    /// Nil when the request never reached the wire (`resolutionFailed`).
    public let durationMs: Int64?
    public let assertionResults: [AssertionResult]

    public init(
        id: String = UUID().uuidString,
        requestId: String,
        name: String,
        method: HttpMethod,
        status: FolderRunItemStatus,
        durationMs: Int64?,
        assertionResults: [AssertionResult],
    ) {
        self.id = id
        self.requestId = requestId
        self.name = name
        self.method = method
        self.status = status
        self.durationMs = durationMs
        self.assertionResults = assertionResults
    }
}

/// The outcome of running every request nested under one folder: one
/// `FolderRunItem` per request, in run order, plus the totals the sidebar's
/// summary header shows.
public struct FolderRunSummary: Sendable, Equatable {
    public let folderId: String
    public let folderName: String
    public let items: [FolderRunItem]
    public let startedAt: Date
    public let totalDurationMs: Int64
    /// The scope after every capture in the run has been folded in — the
    /// caller feeds this back into the environment the same way a single
    /// request's `RunResult.scope` does.
    public let finalScope: VariableScope

    public init(
        folderId: String,
        folderName: String,
        items: [FolderRunItem],
        startedAt: Date,
        totalDurationMs: Int64,
        finalScope: VariableScope,
    ) {
        self.folderId = folderId
        self.folderName = folderName
        self.items = items
        self.startedAt = startedAt
        self.totalDurationMs = totalDurationMs
        self.finalScope = finalScope
    }

    public var passedCount: Int { items.filter { !$0.status.isFailure }.count }
    public var failedCount: Int { items.filter { $0.status.isFailure }.count }
}
