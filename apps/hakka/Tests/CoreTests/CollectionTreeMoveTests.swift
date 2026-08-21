import Foundation
import Testing

@testable import HakkaCore

/// `Collection.movingNode` — the pure tree half of sidebar drag-and-drop
/// move and reorder.
@Suite("collection move")
struct CollectionTreeMoveTests {
    private func tempDir() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hakka-move-\(UUID().uuidString)")
    }

    @Test("moving a request into a folder relocates it without touching its id")
    func crossFolderMove() throws {
        let request = RequestSpec(name: "Get Users", url: "https://example.com/users")
        let folder = Folder(name: "Auth")
        let collection = Collection(name: "API", nodes: [.request(request), .folder(folder)])

        let updated = try collection.movingNode(id: request.id, toFolder: folder.id, atIndex: 0)

        #expect(updated.nodes.count == 1)
        guard case let .folder(movedInto) = updated.nodes[0] else {
            Issue.record("expected the folder to survive")
            return
        }
        #expect(movedInto.children.count == 1)
        #expect(movedInto.children[0].id == request.id)
        #expect(movedInto.children[0].name == "Get Users")
    }

    @Test("moving onto an existing name renames the moved request instead of overwriting the sibling")
    func nameCollisionRenamesOnArrival() throws {
        let incoming = RequestSpec(name: "Get Users", url: "https://example.com/a/users")
        let resident = RequestSpec(name: "Get Users", url: "https://example.com/b/users")
        let folder = Folder(name: "Target", children: [.request(resident)])
        let collection = Collection(name: "API", nodes: [.request(incoming), .folder(folder)])

        let updated = try collection.movingNode(id: incoming.id, toFolder: folder.id, atIndex: 0)

        guard case let .folder(destination) = updated.nodes[0] else {
            Issue.record("expected the folder to survive")
            return
        }
        #expect(destination.children.count == 2)
        // Both requests still exist, under distinct names — neither the
        // resident nor the incoming request was silently dropped.
        let names = Set(destination.children.map(\.name))
        #expect(names == ["Get Users", "Get Users copy"])
        let urls = Set(destination.children.compactMap { node -> String? in
            guard case let .request(spec) = node else { return nil }
            return spec.url
        })
        #expect(urls == ["https://example.com/a/users", "https://example.com/b/users"])
    }

    @Test("moving a folder into its own descendant is refused, not silently applied")
    func refusesCycle() throws {
        let child = Folder(name: "Child")
        let parent = Folder(name: "Parent", children: [.folder(child)])
        let collection = Collection(name: "API", nodes: [.folder(parent)])

        #expect(throws: CollectionMoveError.wouldCreateCycle) {
            _ = try collection.movingNode(id: parent.id, toFolder: child.id, atIndex: 0)
        }
    }

    @Test("moving an unknown id throws instead of returning an unchanged tree")
    func unknownNodeThrows() throws {
        let collection = Collection(name: "API")
        #expect(throws: CollectionMoveError.nodeNotFound(id: "missing")) {
            _ = try collection.movingNode(id: "missing", toFolder: nil, atIndex: 0)
        }
    }

    @Test("a cross-folder move round-trips through the store: old file gone, new file present")
    func storeRoundTrip() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let request = RequestSpec(name: "Get Users", url: "https://example.com/users")
        let folder = Folder(name: "Auth")
        let seeded = Collection(name: "API", nodes: [.request(request), .folder(folder)])
        try await store.save(seeded, to: dir)

        let moved = try seeded.movingNode(id: request.id, toFolder: folder.id, atIndex: 0)
        try await store.save(moved, to: dir)

        let reloaded = try await store.load(directory: dir)
        #expect(reloaded.nodes.count == 1)
        guard case let .folder(reloadedFolder) = reloaded.nodes[0] else {
            Issue.record("expected the folder to survive the round trip")
            return
        }
        #expect(reloadedFolder.children.map(\.id) == [request.id])
        #expect(!FileManager.default.fileExists(atPath: dir.appendingPathComponent("get-users.hakka").path))
    }
}
