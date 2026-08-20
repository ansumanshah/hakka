import Foundation
import Testing

@testable import HakkaDesktopCore

/// A request named "Collection" or "Folder" slugifies onto the basename the
/// store uses for a container's own metadata file. Before the reserve fix,
/// saving one overwrote that metadata and the next `load()` threw, taking the
/// whole collection with it — ordinary user input, total data loss.
@Suite("container-name collisions")
struct ContainerNameCollisionTests {
    private func tempDir() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hakka-collision-\(UUID().uuidString)")
    }

    @Test("a root request named Collection does not clobber collection metadata")
    func rootCollectionName() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let collection = Collection(
            name: "API",
            nodes: [.request(RequestSpec(name: "Collection", url: "https://example.com/a"))],
        )
        try await store.save(collection, to: dir)
        let reloaded = try await store.load(directory: dir)

        #expect(reloaded.name == "API")
        #expect(reloaded.nodes.count == 1)
        #expect(reloaded.nodes.first?.name == "Collection")
    }

    @Test("a request named Folder inside a folder does not clobber folder metadata")
    func nestedFolderName() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let collection = Collection(
            name: "API",
            nodes: [
                .folder(
                    Folder(
                        name: "Auth",
                        children: [.request(RequestSpec(name: "Folder", url: "https://example.com/b"))],
                    ),
                ),
            ],
        )
        try await store.save(collection, to: dir)
        let reloaded = try await store.load(directory: dir)

        guard case let .folder(folder) = reloaded.nodes.first else {
            Issue.record("expected the folder to survive the round trip")
            return
        }
        #expect(folder.name == "Auth")
        #expect(folder.children.count == 1)
        #expect(folder.children.first?.name == "Folder")
    }

    /// The single-request fast path bypasses `save()`'s full reconciliation, so
    /// it needs the same reservation independently.
    @Test("saveRequest alone cannot clobber container metadata")
    func saveRequestFastPath() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let request = RequestSpec(name: "Collection", url: "https://example.com/c")
        let collection = Collection(name: "API", nodes: [.request(request)])
        try await store.save(collection, to: dir)
        try await store.saveRequest(request, in: collection, to: dir)

        let reloaded = try await store.load(directory: dir)
        #expect(reloaded.name == "API")
        #expect(reloaded.nodes.count == 1)
    }
}

/// The format version is stamped on save and gates load. Collections outlive
/// builds and get committed to other people's repos, so "written by a newer
/// Hakka" has to be a clear refusal rather than a decode error.
@Suite("collection format version")
struct CollectionFormatVersionTests {
    private func tempDir() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hakka-version-\(UUID().uuidString)")
    }

    @Test("save stamps the current format version")
    func stampsVersion() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        try await CollectionStore().save(Collection(name: "API"), to: dir)

        let data = try Data(contentsOf: dir.appendingPathComponent("collection.hakka"))
        let json = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["version"] as? Int == collectionFormatVersion)
    }

    @Test("a file with no version reads as the original format")
    func missingVersionIsVersionOne() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()
        try await store.save(Collection(name: "API"), to: dir)

        let url = dir.appendingPathComponent("collection.hakka")
        var json = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
        )
        json.removeValue(forKey: "version")
        try JSONSerialization.data(withJSONObject: json).write(to: url)

        let reloaded = try await store.load(directory: dir)
        #expect(reloaded.name == "API")
    }

    @Test("a newer format version is refused, not half-decoded")
    func refusesNewerVersion() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()
        try await store.save(Collection(name: "API"), to: dir)

        let url = dir.appendingPathComponent("collection.hakka")
        var json = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any],
        )
        json["version"] = collectionFormatVersion + 1
        try JSONSerialization.data(withJSONObject: json).write(to: url)

        await #expect(throws: CollectionStoreError.self) {
            _ = try await store.load(directory: dir)
        }
    }
}
