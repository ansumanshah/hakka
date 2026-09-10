import Foundation
@testable import HakkaApp
import HakkaCore
import Testing

private actor DelayedTransport: RequestTransport {
    private var started = false
    private var startWaiter: CheckedContinuation<Void, Never>?
    private var responseWaiter: CheckedContinuation<TransportResponse, Never>?

    func execute(_: URLRequest, followRedirects _: Bool) async throws -> TransportResponse {
        started = true
        startWaiter?.resume()
        startWaiter = nil
        return await withCheckedContinuation { responseWaiter = $0 }
    }

    func waitUntilStarted() async {
        if started {
            return
        }
        await withCheckedContinuation { startWaiter = $0 }
    }

    func succeed() {
        let url = URL(string: "https://delayed.example")!
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
        responseWaiter?.resume(returning: TransportResponse(data: Data("{}".utf8), response: response))
        responseWaiter = nil
    }
}

@Suite("Request editor drafts")
struct RequestEditorDraftTests {
    @MainActor
    @Test func newRequestRemainsUnsavedWhenItsTabCloses() {
        let model = AppModel()
        model.newRequest()
        let id = model.editor.draft!.id
        #expect(model.editor.isDirty)
        model.closeRequestTab(id: id)
        #expect(model.editor.hasUnsavedDrafts)
        #expect(model.editor.isDirty(requestID: id))
    }

    @Test @MainActor func savedSnapshotDoesNotMarkAnotherOrNewerDraftClean() throws {
        let editor = RequestEditorModel()
        let first = RequestSpec(name: "First")
        let second = RequestSpec(name: "Second")
        editor.load(first)
        var written = first
        written.name = "Written"
        editor.draft = written
        var newer = written
        newer.name = "Newer unsaved edit"
        editor.draft = newer
        editor.load(second)
        var other = second
        other.name = "Other unsaved edit"
        editor.draft = other
        editor.markSaved(written)
        #expect(editor.draft == other)
        #expect(editor.isDirty)
        editor.load(first)
        #expect(editor.draft == newer)
        #expect(editor.isDirty)
    }

    @Test @MainActor func navigationPreservesEachRequestWorkingCopy() throws {
        let editor = RequestEditorModel()
        let first = RequestSpec(name: "First", url: "https://first.example")
        let second = RequestSpec(name: "Second", url: "https://second.example")
        editor.load(first)
        var edited = try #require(editor.draft)
        edited.url = "https://edited.example"
        editor.draft = edited

        editor.load(second)
        editor.load(first)
        #expect(editor.draft?.url == "https://edited.example")
        #expect(editor.isDirty)
    }

    @Test @MainActor func cleanDraftRefreshesFromTheCollectionWhileDirtyDraftWins() throws {
        let editor = RequestEditorModel()
        let original = RequestSpec(name: "Original", url: "https://first.example")
        var refreshed = original
        refreshed.name = "On disk"
        editor.load(original)
        editor.load(refreshed)
        #expect(editor.draft?.name == "On disk")

        var dirty = try #require(editor.draft)
        dirty.name = "Unsaved"
        editor.draft = dirty
        refreshed.name = "Newer on disk"
        editor.load(refreshed)
        #expect(editor.draft?.name == "Unsaved")
    }

    @Test @MainActor func deletingTheSelectedRequestPreservesOtherDirtyDrafts() throws {
        let model = AppModel()
        let first = model.collection.newRequest(named: "First")
        let second = model.collection.newRequest(named: "Second")
        model.select(.request(id: second.id))
        var editedSecond = try #require(model.editor.draft)
        editedSecond.name = "Unsaved second"
        model.editor.draft = editedSecond
        model.select(.request(id: first.id))

        model.deleteNode(id: first.id)
        #expect(model.editor.draft?.id == second.id)
        #expect(model.editor.isDirty)
        model.select(.request(id: second.id))
        #expect(model.editor.draft?.name == "Unsaved second")
        #expect(model.editor.isDirty)
    }

    @Test @MainActor func workspaceTabsFocusOnceCloseAdjacentAndPreserveClosedDraft() throws {
        let model = AppModel()
        let first = model.collection.newRequest(named: "First")
        let second = model.collection.newRequest(named: "Second")
        let third = model.collection.newRequest(named: "Third")

        model.select(.request(id: first.id))
        model.select(.request(id: second.id))
        model.select(.request(id: first.id))
        model.select(.request(id: third.id))
        #expect(model.requestWorkspaceTabs.openRequestIDs == [first.id, second.id, third.id])

        model.select(.request(id: second.id))
        var edited = try #require(model.editor.draft)
        edited.name = "Unsaved second"
        model.editor.draft = edited
        model.closeRequestTab(id: second.id)
        #expect(model.selection == .request(id: third.id))
        #expect(model.requestWorkspaceTabs.openRequestIDs == [first.id, third.id])

        model.select(.request(id: second.id))
        #expect(model.editor.draft?.name == "Unsaved second")
        #expect(model.editor.isDirty)
    }

    @Test @MainActor func workspaceTabCycleWrapsAndDeletionPurgesClosedDraft() throws {
        let model = AppModel()
        let first = model.collection.newRequest(named: "First")
        let second = model.collection.newRequest(named: "Second")
        model.select(.request(id: first.id))
        model.select(.request(id: second.id))
        model.cycleRequestTab(forward: true)
        #expect(model.selection == .request(id: first.id))
        model.cycleRequestTab(forward: false)
        #expect(model.selection == .request(id: second.id))

        var edited = try #require(model.editor.draft)
        edited.name = "Unsaved second"
        model.editor.draft = edited
        model.closeRequestTab(id: second.id)
        model.deleteNode(id: second.id)
        model.editor.load(second)
        #expect(model.editor.draft?.name == "Second")
        #expect(model.requestWorkspaceTabs.openRequestIDs == [first.id])
    }

    @Test @MainActor func delayedSendCompletesOnItsOriginRequestAfterNavigation() async {
        let transport = DelayedTransport()
        let editor = RequestEditorModel(runner: RequestRunner(transport: transport))
        let first = RequestSpec(name: "First", url: "https://delayed.example")
        let second = RequestSpec(name: "Second", url: "https://second.example")
        let collection = Collection(name: "Test")
        editor.load(first)
        let send = Task { await editor.send(collection: collection, folderChain: [], scope: VariableScope()) }
        await transport.waitUntilStarted()

        editor.load(second)
        await transport.succeed()
        _ = await send.value
        #expect(editor.draft?.id == second.id)
        #expect(editor.lastResult == nil)

        editor.load(first)
        #expect(editor.lastResult?.record.url == "https://delayed.example")
    }

    @Test @MainActor func clearInvalidatesAnInFlightSend() async {
        let transport = DelayedTransport()
        let editor = RequestEditorModel(runner: RequestRunner(transport: transport))
        let request = RequestSpec(name: "First", url: "https://delayed.example")
        editor.load(request)
        let send = Task { await editor.send(collection: Collection(name: "Test"), folderChain: [], scope: VariableScope()) }
        await transport.waitUntilStarted()
        editor.clear()
        await transport.succeed()
        let scope = await send.value
        #expect(scope == nil)
        #expect(editor.draft == nil)
        #expect(editor.lastResult == nil)
    }
}
