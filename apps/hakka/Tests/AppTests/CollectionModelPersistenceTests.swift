import Foundation
import HakkaCommon
import HakkaCore
import Testing
@testable import HakkaApp

@Suite("CollectionModel persistence")
@MainActor
struct CollectionModelPersistenceTests {
    private func tempDirectory(_ label: String) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent("hakka-collection-model-\(label)-\(UUID().uuidString)", isDirectory: true)
    }

    @Test func structuralSaveUsesTheLastSavedTreeInsteadOfUnsavedMemory() async throws {
        let directory = tempDirectory("snapshot")
        defer { try? FileManager.default.removeItem(at: directory) }
        let originalRequest = RequestSpec(name: "Original", url: "https://example.test")
        let original = Collection(name: "Original", nodes: [.request(originalRequest)])
        let store = CollectionStore()
        try await store.save(original, to: directory)

        let model = CollectionModel()
        await model.open(directory: directory)
        var editedRequest = originalRequest
        editedRequest.notes = "saved request edit"
        model.update(editedRequest)
        await model.persist(editedRequest)
        #expect(model.lastError == nil)

        _ = model.newRequest(named: "Unsaved local request")
        var updated = model.collection
        updated.name = "Saved structure"

        #expect(await model.adopt(updated))
        #expect(try await store.load(directory: directory) == updated)
    }

    @Test func saveAsBindsAnEmptyDirectoryAndPreservesANonemptyOne() async throws {
        let emptyDirectory = tempDirectory("empty")
        try FileManager.default.createDirectory(at: emptyDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: emptyDirectory) }
        let model = CollectionModel()

        #expect(await model.saveAs(to: emptyDirectory))
        #expect(model.directoryURL == emptyDirectory)
        #expect(try await CollectionStore().load(directory: emptyDirectory) == model.collection)

        let occupiedDirectory = tempDirectory("occupied")
        try FileManager.default.createDirectory(at: occupiedDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: occupiedDirectory) }
        let sentinelURL = occupiedDirectory.appendingPathComponent("keep.txt")
        try Data("keep me".utf8).write(to: sentinelURL)
        let unboundModel = CollectionModel()

        #expect(!(await unboundModel.saveAs(to: occupiedDirectory)))
        #expect(unboundModel.directoryURL == nil)
        #expect(unboundModel.lastError?.contains("new or empty folder") == true)
        #expect(try String(contentsOf: sentinelURL, encoding: .utf8) == "keep me")
    }
}
