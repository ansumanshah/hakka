import Foundation
import Testing

@testable import HakkaCore

/// `CollectionStore.deleteNodes` — atomic multi-select delete. The whole
/// point of the two-phase stage-then-commit design is that a failure on any
/// one target can't leave the others gone with no way back; these tests
/// force exactly that failure (a permission-denied move) and check nothing
/// was lost.
@Suite("collection store deleteNodes")
struct CollectionStoreDeleteNodesTests {
    private func tempDir() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("hakka-delete-\(UUID().uuidString)")
    }

    @Test("deleting several ids at once removes every one of them")
    func deletesAll() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let a = RequestSpec(name: "A", url: "https://example.com/a")
        let b = RequestSpec(name: "B", url: "https://example.com/b")
        let c = RequestSpec(name: "C", url: "https://example.com/c")
        let collection = Collection(name: "API", nodes: [.request(a), .request(b), .request(c)])
        try await store.save(collection, to: dir)

        try await store.deleteNodes(ids: [a.id, b.id], in: collection, from: dir)

        let reloaded = try await store.load(directory: dir)
        #expect(reloaded.nodes.map(\.id) == [c.id])
    }

    /// Locks the folder holding one target so removing its file from that
    /// directory fails partway through the batch, then asserts every
    /// original file — including the two that were *not* locked — is still
    /// exactly where it started. This holds no matter which order the
    /// batch happens to process ids in: either the locked one fails first
    /// (nothing else was ever touched) or last (the already-staged items
    /// get moved back) — both are "nothing lost."
    @Test("one item failing mid-batch rolls every already-staged item back, not just leaves it gone")
    func partialFailureRollsBack() async throws {
        let dir = tempDir()
        let fm = FileManager.default
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        let locked = dir.appendingPathComponent("locked", isDirectory: true)
        defer {
            try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: locked.path)
            try? fm.removeItem(at: dir)
        }
        let store = CollectionStore()

        let rootRequestA = RequestSpec(name: "Root A", url: "https://example.com/a")
        let rootRequestB = RequestSpec(name: "Root B", url: "https://example.com/b")
        let lockedRequest = RequestSpec(name: "Locked", url: "https://example.com/locked")
        let lockedFolder = Folder(name: "Locked", children: [.request(lockedRequest)])
        let collection = Collection(
            name: "API",
            nodes: [.request(rootRequestA), .request(rootRequestB), .folder(lockedFolder)],
        )
        try await store.save(collection, to: dir)

        // Removing a directory entry needs write permission on the
        // directory it lives in, so this makes moving `lockedRequest` out
        // of `locked/` fail while the two root-level requests remain
        // perfectly movable.
        try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: locked.path)

        await #expect(throws: (any Error).self) {
            try await store.deleteNodes(
                ids: [rootRequestA.id, rootRequestB.id, lockedRequest.id],
                in: collection,
                from: dir,
            )
        }

        // Nothing was lost: reloading sees every original node, and no
        // scratch staging directory was left behind.
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: locked.path)
        let reloaded = try await store.load(directory: dir)
        #expect(Set(reloaded.nodes.map(\.id)) == [rootRequestA.id, rootRequestB.id, lockedFolder.id])
        guard case let .folder(reloadedFolder) = reloaded.nodes.first(where: { $0.id == lockedFolder.id }) else {
            Issue.record("expected the locked folder to survive")
            return
        }
        #expect(reloadedFolder.children.map(\.id) == [lockedRequest.id])

        let entries = try fm.contentsOfDirectory(atPath: dir.path)
        #expect(entries.contains { $0.hasPrefix(".hakka-trash-") } == false)
    }

    @Test("deleting an unknown id throws without touching anything else")
    func unknownIDAborts() async throws {
        let dir = tempDir()
        defer { try? FileManager.default.removeItem(at: dir) }
        let store = CollectionStore()

        let a = RequestSpec(name: "A", url: "https://example.com/a")
        let collection = Collection(name: "API", nodes: [.request(a)])
        try await store.save(collection, to: dir)

        await #expect(throws: CollectionStoreError.self) {
            try await store.deleteNodes(ids: [a.id, "missing"], in: collection, from: dir)
        }

        let reloaded = try await store.load(directory: dir)
        #expect(reloaded.nodes.map(\.id) == [a.id])
    }
}
