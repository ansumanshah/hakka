import Foundation
import HakkaCore
import Testing
@testable import HakkaApp

/// `MCPCollectionDirectoryAdapter` wraps whatever single directory
/// `CollectionModel` currently has bound. Proven here against a real
/// `CollectionStore` write to a temp directory, not a stub — the same
/// on-disk shape the MCP collection tools will actually see, per the track
/// brief's "especially that the collection adapter returns what
/// `CollectionStore` actually wrote."
@Suite("MCPCollectionDirectoryAdapter")
@MainActor
struct MCPCollectionDirectoryAdapterTests {
    @Test func reportsNoDirectoriesBeforeAnythingIsOpen() async {
        let adapter = MCPCollectionDirectoryAdapter(collectionModel: CollectionModel())

        #expect(await adapter.collectionDirectories().isEmpty)
    }

    @Test func returnsTheDirectoryCollectionStoreActuallyWrote() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("mcp-collection-adapter-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let store = CollectionStore()
        let written = Collection(
            name: "Fixture",
            nodes: [.request(RequestSpec(name: "GET root", url: "https://example.com"))],
        )
        try await store.save(written, to: directory)

        let collectionModel = CollectionModel()
        await collectionModel.open(directory: directory)

        let adapter = MCPCollectionDirectoryAdapter(collectionModel: collectionModel)

        #expect(await adapter.collectionDirectories() == [directory])
    }

    /// Closing over `collectionModel` at construction time, not copying its
    /// directory once: opening a *second* directory on the same
    /// `CollectionModel` after the adapter already exists must be visible on
    /// the next call — matching `MCPCollectionSource`'s own "reads directly
    /// off `CollectionModel`, no caching" contract.
    @Test func reflectsALaterDirectorySwapWithoutBeingRebuilt() async throws {
        let first = FileManager.default.temporaryDirectory
            .appendingPathComponent("mcp-collection-adapter-first-\(UUID().uuidString)")
        let second = FileManager.default.temporaryDirectory
            .appendingPathComponent("mcp-collection-adapter-second-\(UUID().uuidString)")
        for directory in [first, second] {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        defer {
            try? FileManager.default.removeItem(at: first)
            try? FileManager.default.removeItem(at: second)
        }
        let store = CollectionStore()
        try await store.save(Collection(name: "First", nodes: []), to: first)
        try await store.save(Collection(name: "Second", nodes: []), to: second)

        let collectionModel = CollectionModel()
        await collectionModel.open(directory: first)
        let adapter = MCPCollectionDirectoryAdapter(collectionModel: collectionModel)
        #expect(await adapter.collectionDirectories() == [first])

        await collectionModel.open(directory: second)

        #expect(await adapter.collectionDirectories() == [second])
    }
}
