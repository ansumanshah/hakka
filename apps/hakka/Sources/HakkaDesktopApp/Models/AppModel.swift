import AppKit
import HakkaCommon
import HakkaDesktopCore
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
    let traffic = TrafficModel()
    let editor = RequestEditorModel()

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

    /// The capture → collection promotion: builds a `RequestSpec` from a
    /// live traffic row and opens it in the editor immediately, so saving a
    /// captured request and refining it before a real run is one motion.
    func saveCaptured(_ request: NetworkRequest, named name: String? = nil) {
        let spec = CapturedRequestConverter.requestSpec(from: request, name: name)
        collection.addCaptured(spec)
        select(.request(id: spec.id))
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
    private func clearSelectionIfOrphaned() {
        guard case let .request(id) = selection, collection.request(id: id) == nil else { return }
        selection = nil
        editor.clear()
    }
}
