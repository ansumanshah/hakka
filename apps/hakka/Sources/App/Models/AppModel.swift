import AppKit
import HakkaCommon
import HakkaCore
import Observation
import UniformTypeIdentifiers

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
        let entry = CapturedMockConverter.entry(from: request)
        Task {
            do {
                try await traffic.rules.add(entry.payload, id: entry.id)
                let delivered = try await traffic.send(installCommand(for: entry))
                mockPromotionNote = delivered == 0
                    ? "Mock saved — no devices connected"
                    : "Mock installed to \(delivered) device\(delivered == 1 ? "" : "s")"
            } catch {
                mockPromotionNote = "Mock failed: \(error.localizedDescription)"
            }
            try? await Task.sleep(for: .seconds(2.5))
            mockPromotionNote = nil
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

    // MARK: - Traffic session files

    /// Writes the captured buffer to a `.hakka-session` file the user names.
    func exportTrafficSession() async {
        guard let data = await traffic.exportSession(named: "Capture") else {
            traffic.lastError = "Nothing to export."
            return
        }
        await writeToPanel(data: data, suggestedName: "capture.\(TrafficSession.fileExtension)")
    }

    /// HAR 1.2, for handing the capture to a tool that isn't Hakka.
    func exportTrafficHar() async {
        guard let data = await traffic.exportHar() else {
            traffic.lastError = "Nothing to export."
            return
        }
        await writeToPanel(data: data, suggestedName: "capture.har")
    }

    func importTrafficSession() async {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowsMultipleSelection = false
        // `.hakka-session` has no registered UTI, so derive a dynamic one from
        // the extension rather than reaching for the deprecated
        // `allowedFileTypes`. A nil result means the picker simply doesn't
        // filter, which is a better failure than refusing to open.
        if let type = UTType(filenameExtension: TrafficSession.fileExtension) {
            panel.allowedContentTypes = [type]
        }
        panel.prompt = "Open"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        guard let data = try? Data(contentsOf: url) else {
            traffic.lastError = "Could not read \(url.lastPathComponent)."
            return
        }
        traffic.lastError = await traffic.importSession(from: data)
    }

    private func writeToPanel(data: Data, suggestedName: String) async {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.prompt = "Export"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try data.write(to: url, options: .atomic)
            traffic.lastError = nil
        } catch {
            traffic.lastError = "Export failed: \(error.localizedDescription)"
        }
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
