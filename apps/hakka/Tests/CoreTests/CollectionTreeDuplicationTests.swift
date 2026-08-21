import Foundation
import Testing

@testable import HakkaCore

/// `Collection.duplicatingNode` — the pure tree half of sidebar Duplicate.
@Suite("collection duplicate")
struct CollectionTreeDuplicationTests {
    private func tempDir() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hakka-duplicate-\(UUID().uuidString)")
    }

    @Test("duplicating a request gives it a fresh id and inserts it right after the original")
    func freshIDAndPosition() {
        let original = RequestSpec(name: "Get Users", url: "https://example.com/users")
        let other = RequestSpec(name: "Get Posts", url: "https://example.com/posts")
        let collection = Collection(name: "API", nodes: [.request(original), .request(other)])

        let result = collection.duplicatingNode(id: original.id)
        #expect(result != nil)
        guard let (updated, newID) = result else { return }

        #expect(newID != original.id)
        #expect(updated.nodes.count == 3)
        #expect(updated.nodes[0].id == original.id)
        #expect(updated.nodes[1].id == newID)
        #expect(updated.nodes[2].id == other.id)
    }

    @Test("duplicating into a name collision gets a copy suffix, not an identical sibling name")
    func nameCollisionResolved() {
        let original = RequestSpec(name: "Get Users", url: "https://example.com/users")
        let collection = Collection(name: "API", nodes: [.request(original)])

        guard let (once, _) = collection.duplicatingNode(id: original.id) else {
            Issue.record("expected a duplicate")
            return
        }
        #expect(once.nodes.map(\.name) == ["Get Users", "Get Users copy"])

        // Duplicating the original again, with the first copy already
        // sitting there, has to skip past "copy" too.
        guard let (twice, _) = once.duplicatingNode(id: original.id) else {
            Issue.record("expected a second duplicate")
            return
        }
        #expect(twice.nodes.map(\.name) == ["Get Users", "Get Users copy 2", "Get Users copy"])
    }

    @Test("duplicating a folder gives every descendant a fresh id too")
    func folderDeepClone() {
        let child = RequestSpec(name: "Get Users", url: "https://example.com/users")
        let folder = Folder(name: "Auth", children: [.request(child)])
        let collection = Collection(name: "API", nodes: [.folder(folder)])

        guard let (updated, newID) = collection.duplicatingNode(id: folder.id) else {
            Issue.record("expected a duplicate")
            return
        }
        guard case let .folder(copiedFolder) = updated.nodes[1] else {
            Issue.record("expected the copy to be a folder")
            return
        }
        #expect(copiedFolder.id == newID)
        #expect(copiedFolder.id != folder.id)
        #expect(copiedFolder.children.count == 1)
        #expect(copiedFolder.children[0].id != child.id)
        #expect(copiedFolder.children[0].name == child.name)
    }

    @Test("a duplicate round-trips through the store as two distinct files")
    func storeRoundTrip() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let original = RequestSpec(name: "Get Users", url: "https://example.com/users")
        let seeded = Collection(name: "API", nodes: [.request(original)])
        guard let (duplicated, newID) = seeded.duplicatingNode(id: original.id) else {
            Issue.record("expected a duplicate")
            return
        }
        try await store.save(duplicated, to: dir)

        let reloaded = try await store.load(directory: dir)
        #expect(reloaded.nodes.count == 2)
        #expect(Set(reloaded.nodes.map(\.id)) == [original.id, newID])
        #expect(reloaded.nodes.map(\.name).sorted() == ["Get Users", "Get Users copy"])
    }
}
