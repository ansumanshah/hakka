import HakkaCore
import Observation

/// Request-scoped working copies for the editor. Selecting another request
/// changes only the visible state; unsaved edits and outcomes stay with the
/// request that produced them.
@MainActor
@Observable
final class RequestEditorModel {
    private struct RequestState {
        var draft: RequestSpec
        var savedSnapshot: RequestSpec?
        var lastResult: RunResult?
        var lastRunError: String?
        var sendGeneration = 0
        var isSending = false
    }

    private enum Completion {
        case success(RunResult)
        case failure(String)
    }

    private var states: [String: RequestState] = [:]
    private var activeRequestID: String?
    private var lifecycleGeneration = 0

    var draft: RequestSpec? {
        get { activeRequestID.flatMap { states[$0]?.draft } }
        set {
            guard let id = activeRequestID, var state = states[id], let newValue else { return }
            state.draft = newValue
            states[id] = state
        }
    }

    private var activeState: RequestState? {
        activeRequestID.flatMap { states[$0] }
    }

    var lastResult: RunResult? {
        activeState?.lastResult
    }

    var isSending: Bool {
        activeState?.isSending ?? false
    }

    var lastRunError: String? {
        activeState?.lastRunError
    }

    private let runner: RequestRunner
    private let grpcRunner = GrpcRunner()
    private let oauth2Runner = OAuth2FlowRunner()

    init(runner: RequestRunner = RequestRunner()) {
        self.runner = runner
    }

    var isDirty: Bool {
        guard let state = activeState else { return false }
        return state.draft != state.savedSnapshot
    }

    func isDirty(requestID: String) -> Bool {
        guard let state = states[requestID] else { return false }
        return state.draft != state.savedSnapshot
    }

    var hasUnsavedDrafts: Bool { states.values.contains { $0.draft != $0.savedSnapshot } }

    func load(_ spec: RequestSpec) {
        activeRequestID = spec.id
        if let state = states[spec.id], state.draft == state.savedSnapshot, state.savedSnapshot != spec {
            states[spec.id] = RequestState(draft: spec, savedSnapshot: spec)
        } else if states[spec.id] == nil {
            states[spec.id] = RequestState(draft: spec, savedSnapshot: spec)
        }
    }

    /// Newly authored or captured requests have no disk snapshot yet.
    func markUnsaved(requestID: String) {
        guard var state = states[requestID] else { return }
        state.savedSnapshot = nil
        states[requestID] = state
    }

    func markSaved() {
        if let draft { markSaved(draft) }
    }

    /// A save belongs to its originating request, even if navigation or more
    /// editing happened while the disk write was in flight.
    func markSaved(_ saved: RequestSpec) {
        guard var state = states[saved.id] else { return }
        state.savedSnapshot = saved
        states[saved.id] = state
    }

    /// Project changes and orphaned selections clear every cache entry. A
    /// later completion from the old project cannot repopulate this editor.
    func clear() {
        lifecycleGeneration &+= 1
        activeRequestID = nil
        states.removeAll()
    }

    /// Removes one request after it was deleted from the collection without
    /// discarding unsaved work associated with every other request.
    func discard(requestID: String) {
        states.removeValue(forKey: requestID)
        if activeRequestID == requestID {
            activeRequestID = nil
        }
    }

    /// Removes cached drafts for requests removed from the collection. This
    /// also covers a previously closed tab, whose draft is intentionally kept
    /// until its backing request disappears.
    func discardMissing(keeping requestIDs: Set<String>) {
        states = states.filter { requestIDs.contains($0.key) }
        if let activeRequestID, !requestIDs.contains(activeRequestID) {
            self.activeRequestID = nil
        }
    }

    @discardableResult
    func send(collection: Collection, folderChain: [Folder], scope: VariableScope) async -> VariableScope? {
        guard let requestID = activeRequestID, let state = states[requestID] else { return nil }
        let request = state.draft
        let startingLifecycle = lifecycleGeneration
        let sendGeneration = state.sendGeneration + 1
        update(requestID) {
            $0.sendGeneration = sendGeneration
            $0.isSending = true
        }

        let auth = RequestResolver.effectiveAuth(request: request.auth, folderChain: folderChain, collectionAuth: collection.auth)
        let refreshedScope = await OAuth2TokenRefresher.refreshIfNeeded(auth: auth, scope: scope, runner: oauth2Runner)

        if GrpcURL.isGrpcURL(request.url) {
            do {
                let result = try await grpcRunner.run(request, folderChain: folderChain, collection: collection, scope: refreshedScope)
                return complete(.success(result), requestID: requestID, lifecycle: startingLifecycle, sendGeneration: sendGeneration)
            } catch {
                return complete(.failure(Self.describe(error)), requestID: requestID, lifecycle: startingLifecycle, sendGeneration: sendGeneration)
            }
        }

        do {
            let result = try await runner.run(request, folderChain: folderChain, collection: collection, scope: refreshedScope)
            return complete(.success(result), requestID: requestID, lifecycle: startingLifecycle, sendGeneration: sendGeneration)
        } catch {
            return complete(.failure(Self.describe(error)), requestID: requestID, lifecycle: startingLifecycle, sendGeneration: sendGeneration)
        }
    }

    private func complete(_ completion: Completion, requestID: String, lifecycle: Int, sendGeneration: Int) -> VariableScope? {
        guard var state = states[requestID], lifecycleGeneration == lifecycle, state.sendGeneration == sendGeneration else { return nil }
        state.isSending = false
        switch completion {
        case let .success(result):
            state.lastResult = result
            state.lastRunError = nil
            states[requestID] = state
            return result.scope
        case let .failure(message):
            state.lastResult = nil
            state.lastRunError = message
            states[requestID] = state
            return nil
        }
    }

    private func update(_ requestID: String, mutate: (inout RequestState) -> Void) {
        guard var state = states[requestID] else { return }
        mutate(&state)
        states[requestID] = state
    }

    private static func describe(_ error: Error) -> String {
        guard let error = error as? RequestRunnerError else { return error.localizedDescription }
        return switch error {
        case let .resolution(inner): "Couldn't resolve request: \(inner)"
        case let .bodyEncoding(inner): "Couldn't encode body: \(inner)"
        case .script(.timeout): "Pre-request script timed out"
        case let .script(.runtimeError(message)): "Pre-request script error: \(message)"
        }
    }
}
