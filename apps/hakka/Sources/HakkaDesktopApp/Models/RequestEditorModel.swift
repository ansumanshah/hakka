import HakkaDesktopCore
import Observation

/// The single working copy the request editor pane binds to. One draft at a
/// time — switching the sidebar selection loads a fresh copy here rather
/// than keeping per-request drafts, so unsaved edits are lost on switch
/// (acceptable for v1; a future pass could key drafts by request id).
@MainActor
@Observable
final class RequestEditorModel {
    /// Not `private(set)`: the editor view binds directly into this via a
    /// computed `Binding` it builds itself, so field edits write straight
    /// through without a model-side mutation closure for every keystroke.
    var draft: RequestSpec?
    private var savedSnapshot: RequestSpec?
    private(set) var lastResult: RunResult?
    private(set) var isSending = false
    var lastRunError: String?

    private let runner = RequestRunner()

    var isDirty: Bool {
        guard let draft else { return false }
        return draft != savedSnapshot
    }

    func load(_ spec: RequestSpec) {
        guard draft?.id != spec.id else { return }
        draft = spec
        savedSnapshot = spec
        lastResult = nil
        lastRunError = nil
    }

    func markSaved() {
        savedSnapshot = draft
    }

    /// Drops the draft entirely — used when the request backing it is no
    /// longer in the collection tree (deleted, or the collection directory
    /// changed under it), as opposed to `load`'s switch-to-another-request.
    func clear() {
        draft = nil
        savedSnapshot = nil
        lastResult = nil
        lastRunError = nil
    }

    /// Sends `draft`. Returns the run's updated scope (with any captures
    /// folded in) on success so the caller can feed it back into
    /// `EnvironmentModel.adoptRuntime`; `nil` on a pre-send failure
    /// (`RequestRunnerError` — missing variables, bad URL, unencodable body).
    @discardableResult
    func send(collection: Collection, folderChain: [Folder], scope: VariableScope) async -> VariableScope? {
        guard let draft else { return nil }
        isSending = true
        defer { isSending = false }
        do {
            let result = try await runner.run(draft, folderChain: folderChain, collection: collection, scope: scope)
            lastResult = result
            lastRunError = nil
            return result.scope
        } catch {
            lastRunError = String(describing: error)
            return nil
        }
    }
}
