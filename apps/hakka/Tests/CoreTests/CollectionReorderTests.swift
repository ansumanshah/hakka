import Foundation
import Testing

@testable import HakkaCore

/// Order isn't a separate field a caller sets — it's the array position of
/// each node in its parent's `nodes`/`children`, which `CollectionStore`
/// persists as an explicit `seq` int in every node's own file (see
/// `CollectionLayoutResolver`/`CollectionStore+Load`) and re-sorts by on
/// load. A same-folder `movingNode` call (same `folderID`, new `index`) is
/// how the sidebar's drag-reorder expresses "surviving a save/load round
/// trip" is exactly `seq` doing its job.
@Suite("collection reorder")
struct CollectionReorderTests {
    private func tempDir() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hakka-reorder-\(UUID().uuidString)")
    }

    @Test("reordering root requests survives a save/load round trip")
    func rootReorderRoundTrips() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let first = RequestSpec(name: "First", url: "https://example.com/1")
        let second = RequestSpec(name: "Second", url: "https://example.com/2")
        let third = RequestSpec(name: "Third", url: "https://example.com/3")
        let seeded = Collection(name: "API", nodes: [.request(first), .request(second), .request(third)])
        try await store.save(seeded, to: dir)

        // Move "Third" to the front.
        let reordered = try seeded.movingNode(id: third.id, toFolder: nil, atIndex: 0)
        #expect(reordered.nodes.map(\.id) == [third.id, first.id, second.id])
        try await store.save(reordered, to: dir)

        let reloaded = try await store.load(directory: dir)
        #expect(reloaded.nodes.map(\.id) == [third.id, first.id, second.id])
        #expect(reloaded.nodes.map(\.name) == ["Third", "First", "Second"])
    }

    @Test("reordering within a folder survives a save/load round trip")
    func folderReorderRoundTrips() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let a = RequestSpec(name: "A", url: "https://example.com/a")
        let b = RequestSpec(name: "B", url: "https://example.com/b")
        let folder = Folder(name: "Auth", children: [.request(a), .request(b)])
        let seeded = Collection(name: "API", nodes: [.folder(folder)])
        try await store.save(seeded, to: dir)

        let reordered = try seeded.movingNode(id: b.id, toFolder: folder.id, atIndex: 0)
        try await store.save(reordered, to: dir)

        let reloaded = try await store.load(directory: dir)
        guard case let .folder(reloadedFolder) = reloaded.nodes[0] else {
            Issue.record("expected the folder to survive")
            return
        }
        #expect(reloadedFolder.children.map(\.id) == [b.id, a.id])
    }
}
