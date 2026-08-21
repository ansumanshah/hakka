import HakkaCore
import Observation

/// Drives one folder run and holds its last summary for the detail pane —
/// the mini collection runner's app-side state, kept separate from
/// `CollectionModel`/`RequestEditorModel` so wiring it in touches
/// `AppModel` in as few places as possible.
@MainActor @Observable
final class FolderRunModel {
    private(set) var summary: FolderRunSummary?
    /// The folder currently running, so the sidebar can show a spinner on
    /// exactly that row instead of a single app-wide flag.
    private(set) var runningFolderID: String?
    /// Set when the folder (recursively) had no requests to run — distinct
    /// from `summary == nil`'s "no run yet" so the detail pane can say so
    /// instead of falling back to the generic empty state.
    private(set) var lastRunWasEmpty = false

    /// `nil` uses `FolderRunner`'s own default (`URLSessionTransport`);
    /// tests inject a stub here so a run never touches the network — the
    /// same seam `RequestTransport` gives `RequestRunner`/`FolderRunner`.
    private let transport: RequestTransport?

    init(transport: RequestTransport? = nil) {
        self.transport = transport
    }

    var isRunning: Bool { runningFolderID != nil }

    /// Runs every request nested under `folder`, threading captures and
    /// cookies forward across the run (see `FolderRunner`). Returns the
    /// run's final scope on success so the caller can fold it into the
    /// environment's runtime values, the same way a single send's result
    /// does — `nil` when the folder had nothing to run.
    @discardableResult
    func run(_ folder: Folder, folderChain: [Folder], collection: Collection, scope: VariableScope) async -> VariableScope? {
        runningFolderID = folder.id
        defer { runningFolderID = nil }

        let runner = FolderRunner(transport: transport)
        let result = await runner.run(folder, folderChain: folderChain, collection: collection, scope: scope)
        lastRunWasEmpty = result == nil
        summary = result
        return result?.finalScope
    }
}
