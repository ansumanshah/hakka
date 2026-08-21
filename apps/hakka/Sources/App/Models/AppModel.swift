import AppKit
import HakkaCommon
import HakkaCore
import Observation

/// Composition root: one instance per window, injected via `.environment`.
/// Owns the four sub-models and the cross-cutting actions (select, send,
/// save) that need more than one of them — the sub-models themselves never
/// reach sideways into each other.
@MainActor
@Observable
final class AppModel {
    let collection = CollectionModel()
    let environment = EnvironmentModel()
    let traffic: TrafficModel
    let editor = RequestEditorModel()
    let rules: RulesModel
    let folderRun = FolderRunModel()
    let webSocket = WebSocketConnectionModel()

    init() {
        let traffic = TrafficModel()
        self.traffic = traffic
        self.rules = RulesModel(traffic: traffic)
    }

    private(set) var selection: SidebarSelection?

    func select(_ selection: SidebarSelection?) {
        self.selection = selection
        if case let .request(id) = selection, let spec = collection.request(id: id) {
            editor.load(spec)
        }
    }

    func newRequest() {
        let spec = collection.newRequest()
        select(.request(id: spec.id))
    }

    /// Routes sidebar deletes through here (instead of `collection.delete`
    /// directly) so a delete of the currently-open request or an ancestor
    /// folder can't leave `selection`/`editor.draft` pointing at a node the
    /// tree no longer has — which would let the editor keep accepting edits
    /// that `persist`'s tree-walk silently drops.
    func deleteNode(id: String) {
        collection.delete(id: id)
        clearSelectionIfOrphaned()
    }

    /// Writes to disk before flipping the dirty flag: if `persist` fails,
    /// `collection.lastError` is left set and `editor.isDirty` stays true so
    /// the Save menu item (its sole gate) doesn't lie about the edit being
    /// safe. `ContentView` surfaces `lastError` to the user.
    func saveActiveRequest() async {
        guard let draft = editor.draft else { return }
        collection.update(draft)
        await collection.persist(draft)
        if collection.lastError == nil {
            editor.markSaved()
        }
    }

    func sendActiveRequest() async {
        guard let draft = editor.draft else { return }
        let folderChain = collection.folderChain(for: draft.id)
        guard let updatedScope = await editor.send(
            collection: collection.collection,
            folderChain: folderChain,
            scope: environment.scope,
        ) else { return }
        environment.adoptRuntime(from: updatedScope)
    }

    /// The folder-run affordance: runs every request nested under `folder`
    /// in order, threading captures and cookies forward, then selects the
    /// folder so `DetailPaneView` shows the resulting summary.
    func runFolder(_ folder: Folder) async {
        let folderChain = collection.folderChain(for: folder.id)
        let updatedScope = await folderRun.run(folder, folderChain: folderChain, collection: collection.collection, scope: environment.scope)
        if let updatedScope { environment.adoptRuntime(from: updatedScope) }
        select(.folderRun(id: folder.id))
    }

    /// The capture → collection promotion: builds a `RequestSpec` from a
    /// live traffic row and opens it in the editor immediately, so saving a
    /// captured request and refining it before a real run is one motion.
    func saveCaptured(_ request: NetworkRequest, named name: String? = nil) {
        let spec = CapturedRequestConverter.requestSpec(from: request, name: name)
        collection.addCaptured(spec)
        select(.request(id: spec.id))
    }

    /// Replays a captured request as-is: promotes it into the collection —
    /// the same artifact Save to Collection creates, kept because the replay
    /// and its response stay inspectable in the editor — and sends it
    /// immediately. `saveCaptured` loads the editor synchronously, so the
    /// draft is ready when the send runs.
    func replayCaptured(_ request: NetworkRequest) {
        saveCaptured(request)
        Task { await sendActiveRequest() }
    }

    /// Transient feedback from the last capture → mock promotion, shown by
    /// the detail action bar.
    var mockPromotionNote: String?

    /// The capture → mock promotion: freezes the captured response into a
    /// mock rule and installs it on every connected device in one action —
    /// replay the app's real response with no proxy in the path. Re-promoting
    /// the same endpoint replaces (same wire id) instead of duplicating.
    func promoteCapturedToMock(_ request: NetworkRequest) {
        Task {
            do {
                let delivered = try await rules.promote(request)
                mockPromotionNote = delivered == 0
                    ? "Mock saved — no devices connected"
                    : "Mock installed to \(delivered) device\(delivered == 1 ? "" : "s")"
            } catch {
                mockPromotionNote = "Mock failed: \(error.localizedDescription)"
            }
            let shown = mockPromotionNote
            try? await Task.sleep(for: .seconds(2.5))
            // A second promotion during the window owns the note now.
            if mockPromotionNote == shown { mockPromotionNote = nil }
        }
    }

    /// Blocking `runModal()` is the standard AppKit idiom for a directory
    /// picker; it does not conflict with structured concurrency here since
    /// nothing else is awaited while the panel is up.
    func openCollectionDirectory() async {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Open"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        await collection.open(directory: url)
        clearSelectionIfOrphaned()
        await environment.load(forCollectionAt: url)
    }

    /// Clears the selection whenever it points at a request id the current
    /// `collection` tree no longer resolves — after a delete, or after the
    /// whole tree was swapped by opening a different directory. `.traffic`
    /// and `nil` selections are untouched.
    func clearSelectionIfOrphaned() {
        guard case let .request(id) = selection, collection.request(id: id) == nil else { return }
        selection = nil
        editor.clear()
    }
}
