import Foundation
import HakkaCommon

/// Runs every request nested under one folder sequentially — the mini
/// collection runner every competitor API client ships. An actor for the
/// same reason `RequestRunner` is one: it serializes concurrent `run` calls
/// against the transport/jar it owns.
///
/// State threading is the entire point of a folder run over a plain
/// for-loop of independent sends:
///
/// - **Captures carry forward.** Each request's `RunResult.scope` (already
///   folded with that request's `ResponseCapture`s by `RequestRunner`)
///   becomes the `scope` passed into the *next* request's resolve, so a
///   login request at the top of the folder supplies the token every later
///   request interpolates — exactly like the existing single-request
///   send-then-reuse path in `RunnerTests.captureThenReuseFeedsNextRequest`,
///   just chained across many requests instead of two.
/// - **One cookie jar for the whole run.** A fresh `CookieJar` is created
///   per `run` call and handed to a single `RequestRunner` used for every
///   request in it, so a `Set-Cookie` from request 2 rides on request 5's
///   `Cookie` header. The jar is scoped to this call: it is never the
///   default jar a lone `RequestEditorModel` send uses, so a folder run
///   can't leak a session cookie into ad hoc single-request sends, and a
///   fresh jar per call means one folder run can't leak into another.
///
/// Failure mode — **a failing request does not stop the run.** Every
/// request in the plan is attempted regardless of what happened before it;
/// the summary records each outcome. The alternative (stop at the first
/// failure) is defensible and some competitors do it, but it costs
/// information a folder run exists to provide: if request 3 of 10 fails,
/// stopping hides whether 4 through 10 are also broken, forcing the user
/// back through several run-fix-run cycles to find every problem in a
/// smoke suite instead of seeing them all in one pass. The cost of
/// continuing is that a request downstream of a failed capture may itself
/// fail resolution (its `{{variable}}` never got set) — but that failure is
/// reported the same way as any other, so it reads as diagnostic signal
/// ("this also needs fixing"), not as noise.
public actor FolderRunner {
    private let runner: RequestRunner

    public init(transport: RequestTransport? = nil, defaultTimeout: TimeInterval = 30) {
        runner = RequestRunner(transport: transport, defaultTimeout: defaultTimeout, cookies: CookieJar())
    }

    /// Returns `nil` when `folder` contains no requests anywhere in its
    /// subtree — an empty run has nothing to summarize, and returning a
    /// summary with zero items would read as "0 passed, 0 failed" i.e. a
    /// vacuous success rather than "there was nothing to run here."
    public func run(
        _ folder: Folder,
        folderChain: [Folder] = [],
        collection: Collection,
        scope: VariableScope,
    ) async -> FolderRunSummary? {
        let plan = FolderRunPlan.flatten(folder, ancestorChain: folderChain)
        guard !plan.isEmpty else { return nil }

        let startedAt = Date()
        var items: [FolderRunItem] = []
        var currentScope = scope
        for step in plan {
            let (item, nextScope) = await runOne(step, collection: collection, scope: currentScope)
            items.append(item)
            // A hard failure leaves `currentScope` unchanged, so any capture
            // the failed request would have made simply isn't there for
            // later requests — see the failure-mode note above.
            if let nextScope { currentScope = nextScope }
        }

        return FolderRunSummary(
            folderId: folder.id,
            folderName: folder.name,
            items: items,
            startedAt: startedAt,
            totalDurationMs: Int64(Date().timeIntervalSince(startedAt) * 1000),
            finalScope: currentScope,
        )
    }

    private func runOne(
        _ step: FolderRunPlanItem,
        collection: Collection,
        scope: VariableScope,
    ) async -> (FolderRunItem, VariableScope?) {
        do {
            let result = try await runner.run(step.request, folderChain: step.folderChain, collection: collection, scope: scope)
            let item = FolderRunItem(
                requestId: step.request.id,
                name: step.request.name,
                method: step.request.method,
                status: Self.status(for: result),
                durationMs: result.record.duration,
                assertionResults: result.assertionResults,
            )
            return (item, result.scope)
        } catch {
            let item = FolderRunItem(
                requestId: step.request.id,
                name: step.request.name,
                method: step.request.method,
                status: .resolutionFailed(String(describing: error)),
                durationMs: nil,
                assertionResults: [],
            )
            return (item, nil)
        }
    }

    private static func status(for result: RunResult) -> FolderRunItemStatus {
        if let error = result.record.error {
            return .requestFailed(error)
        }
        let failed = result.assertionResults.filter { !$0.passed }
        guard failed.isEmpty else { return .assertionsFailed(failedCount: failed.count) }
        return .passed
    }
}
