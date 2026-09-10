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
    let requestWorkspaceTabs = RequestWorkspaceTabsModel()
    let rules: RulesModel
    let folderRun = FolderRunModel()
    let webSocket = WebSocketConnectionModel()
    let pauseInbox: PauseInboxModel
    let sessionCompare = SessionCompareModel()
    let logs = LogsModel()
    let storage = StorageModel()
    let proxy: ProxyCaptureModel
    /// The native MCP server's lifecycle, surfaced by the Settings toggle
    /// (`MCPSettingsSection`). Constructed here (not started here) so it
    /// exists for the whole window's lifetime the same as every other
    /// sub-model, wired to this window's own `traffic.store`/`collection` —
    /// see `MCPServerModel`'s doc comment for why it never starts itself.
    let mcp: MCPServerModel

    /// Ids currently marked for a batch delete — toggled from the sidebar's
    /// context menu, cleared once `deleteMarkedNodes()` (in
    /// `AppModel+CollectionActions`) runs.
    var markedForDeletion: Set<String> = []

    init() {
        let traffic = TrafficModel()
        self.traffic = traffic
        rules = RulesModel(traffic: traffic)
        pauseInbox = PauseInboxModel(channel: traffic)
        let proxy = ProxyCaptureModel()
        self.proxy = proxy
        proxy.onBreakpointReady = { [weak traffic] in
            guard let traffic else { return }
            for entry in await traffic.rules.rules() {
                if case .breakpoint = entry.payload {
                    _ = try? await traffic.send(installCommand(for: entry))
                }
            }
        }
        mcp = MCPServerModel(trafficStore: traffic.store, collectionModel: collection,
                             additionalTools: NativeProxyTool.tools(proxy: proxy, traffic: traffic))
    }

    private(set) var selection: SidebarSelection?

    func select(_ selection: SidebarSelection?) {
        if case let .request(id) = selection, let spec = collection.request(id: id) {
            requestWorkspaceTabs.open(id)
            editor.load(spec)
        }
        self.selection = selection
    }

    func newRequest() {
        let spec = collection.newRequest()
        select(.request(id: spec.id))
        editor.markUnsaved(requestID: spec.id)
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

    /// Closes only the visible document. `RequestEditorModel` retains the
    /// working copy so reopening this request cannot silently lose a draft.
    func closeRequestTab(id: String) {
        guard let nextID = requestWorkspaceTabs.close(id) else {
            if case .request = selection { selection = nil }
            return
        }
        guard collection.request(id: nextID) != nil else {
            clearSelectionIfOrphaned()
            return
        }
        select(.request(id: nextID))
    }

    /// Used by the Request menu's document-navigation shortcuts.
    func cycleRequestTab(forward: Bool = true) {
        guard let requestID = requestWorkspaceTabs.cycle(forward: forward) else { return }
        select(.request(id: requestID))
    }

    /// Writes to disk before flipping the dirty flag: if `persist` fails,
    /// `collection.lastError` is left set and `editor.isDirty` stays true so
    /// the Save menu item (its sole gate) doesn't lie about the edit being
    /// safe. `ContentView` surfaces `lastError` to the user.
    func saveActiveRequest() async {
        guard let draft = editor.draft else { return }
        if collection.directoryURL == nil {
            let panel = NSSavePanel()
            panel.title = "Save Collection"
            panel.message = "Create a folder for this collection and its request files."
            panel.nameFieldStringValue = collection.collection.name
            panel.canCreateDirectories = true
            guard panel.runModal() == .OK, let directory = panel.url else { return }
            collection.update(draft)
            guard await collection.saveAs(to: directory) else { return }
        } else {
            collection.update(draft)
            await collection.persist(draft)
            guard collection.lastError == nil else { return }
        }
        editor.markSaved(draft)
    }

    func sendActiveRequest() async {
        guard let draft = editor.draft else { return }
        let folderChain = collection.folderChain(for: draft.id)
        guard let updatedScope = await editor.send(
            collection: collection.collection,
            folderChain: folderChain,
            scope: environment.scope
        ) else { return }
        environment.adoptRuntime(from: updatedScope)
    }

    /// The folder-run affordance: runs every request nested under `folder`
    /// in order, threading captures and cookies forward, then selects the
    /// folder so `DetailPaneView` shows the resulting summary.
    func runFolder(_ folder: Folder) async {
        let folderChain = collection.folderChain(for: folder.id)
        let updatedScope = await folderRun.run(folder, folderChain: folderChain, collection: collection.collection, scope: environment.scope)
        if let updatedScope {
            environment.adoptRuntime(from: updatedScope)
        }
        select(.folderRun(id: folder.id))
    }

    /// The capture → collection promotion: builds a `RequestSpec` from a
    /// live traffic row and opens it in the editor immediately, so saving a
    /// captured request and refining it before a real run is one motion.
    func saveCaptured(_ request: NetworkRequest, named name: String? = nil) {
        let spec = CapturedRequestConverter.requestSpec(from: request, name: name)
        collection.addCaptured(spec)
        select(.request(id: spec.id))
        editor.markUnsaved(requestID: spec.id)
    }

    /// Replays a captured request as-is: promotes it into the collection —
    /// the same artifact Save to Collection creates, kept because the replay
    /// and its response stay inspectable in the editor — and sends it
    /// immediately. `saveCaptured` loads the editor synchronously, so the
    /// draft is ready when the send runs.
    ///
    /// The replayed id is captured synchronously, before the `Task` spawns —
    /// an unstructured `Task` does not start running until this MainActor
    /// turn yields, so a sidebar selection change landing in that window
    /// would otherwise overwrite `editor.draft` before `sendActiveRequest`
    /// ever read it, silently sending the newly selected request instead of
    /// the replay.
    func replayCaptured(_ request: NetworkRequest) {
        saveCaptured(request)
        let replayedID = editor.draft?.id
        Task {
            guard editor.draft?.id == replayedID else { return }
            await sendActiveRequest()
        }
    }

    /// Transient feedback from the last capture → mock promotion, shown by
    /// the detail action bar.
    var mockPromotionNote: String?

    /// The capture → mock promotion: freezes the captured response into a
    /// mock rule and installs it on every connected device in one action —
    /// replay the app's real response with no proxy in the path. Re-promoting
    /// the same endpoint replaces (same wire id) instead of duplicating.
    ///
    /// `pattern`/`method` carry the promote-to-mock sheet's (possibly
    /// edited) match through to `RulesModel.promote`; `nil` installs the
    /// capture's own match unchanged.
    func promoteCapturedToMock(_ request: NetworkRequest, pattern: String? = nil, method: String? = nil) {
        Task {
            do {
                let delivered = try await rules.promote(request, pattern: pattern, method: method)
                mockPromotionNote = delivered == 0
                    ? "Mock saved — no devices connected"
                    : "Mock installed to \(delivered) device\(delivered == 1 ? "" : "s")"
            } catch {
                mockPromotionNote = "Mock failed: \(error.localizedDescription)"
            }
            let shown = mockPromotionNote
            try? await Task.sleep(for: .seconds(2.5))
            // A second promotion during the window owns the note now.
            if mockPromotionNote == shown {
                mockPromotionNote = nil
            }
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
        if editor.hasUnsavedDrafts {
            let alert = NSAlert()
            alert.messageText = "Open another collection with unsaved requests?"
            alert.informativeText = "Unsaved edits, including edits in closed tabs, will be lost. Cancel to save them first."
            alert.addButton(withTitle: "Cancel")
            alert.addButton(withTitle: "Open Without Saving")
            guard alert.runModal() == .alertSecondButtonReturn else { return }
        }
        await collection.open(directory: url)
        if collection.lastError == nil {
            editor.clear()
            requestWorkspaceTabs.reset()
            selection = nil
            await environment.load(forCollectionAt: url)
        }
        clearSelectionIfOrphaned()
    }

    /// Clears the selection whenever it points at a request id the current
    /// `collection` tree no longer resolves — after a delete, or after the
    /// whole tree was swapped by opening a different directory. `.traffic`
    /// and `nil` selections are untouched.
    func clearSelectionIfOrphaned() {
        let activeIDs = Self.requestIDs(in: collection.collection.nodes)
        requestWorkspaceTabs.removeMissing(keeping: activeIDs)
        editor.discardMissing(keeping: activeIDs)
        guard case let .request(id) = selection, collection.request(id: id) == nil else { return }
        if let nextID = requestWorkspaceTabs.selectedRequestID, collection.request(id: nextID) != nil {
            select(.request(id: nextID))
        } else {
            selection = nil
            editor.discard(requestID: id)
        }
    }

    private static func requestIDs(in nodes: [CollectionNode]) -> Set<String> {
        nodes.reduce(into: Set<String>()) { ids, node in
            switch node {
            case let .request(request): ids.insert(request.id)
            case let .folder(folder): ids.formUnion(requestIDs(in: folder.children))
            }
        }
    }
}
