import Foundation
import HakkaCore
import Observation

/// Owns the in-memory `Collection` tree and its on-disk binding. A collection
/// starts in-memory only (`directoryURL == nil`) so the app is usable before
/// the user ever picks a folder; `open(directory:)` swaps in a loaded tree,
/// and every mutating call here updates memory immediately while disk writes
/// only happen once a directory is bound.
@MainActor
@Observable
final class CollectionModel {
    private(set) var collection: Collection
    private(set) var directoryURL: URL?
    var lastError: String?

    private let store = CollectionStore()

    init() {
        collection = Self.seedCollection()
    }

    func request(id: String) -> RequestSpec? {
        Self.findRequest(id: id, in: collection.nodes)
    }

    /// Ancestor folders of `id`, outermost first — the order
    /// `RequestResolver` expects for header/auth inheritance.
    func folderChain(for id: String) -> [Folder] {
        Self.folderChain(for: id, in: collection.nodes, chain: []) ?? []
    }

    @discardableResult
    func newRequest(named name: String = "New Request") -> RequestSpec {
        let spec = RequestSpec(name: name)
        collection.nodes.append(.request(spec))
        return spec
    }

    func newFolder(named name: String = "New Folder") {
        collection.nodes.append(.folder(Folder(name: name)))
    }

    func delete(id: String) {
        collection.nodes = Self.removing(id: id, from: collection.nodes)
    }

    func update(_ spec: RequestSpec) {
        collection.nodes = Self.replacing(spec, in: collection.nodes)
    }

    /// The captured-traffic → collection promotion this app exists for —
    /// always lands at the root, never guesses a folder.
    func addCaptured(_ spec: RequestSpec) {
        collection.nodes.append(.request(spec))
    }

    func open(directory: URL) async {
        do {
            collection = try await store.load(directory: directory)
            directoryURL = directory
            lastError = nil
        } catch {
            lastError = "Couldn't open \(directory.lastPathComponent): \(error.localizedDescription)"
        }
    }

    /// Narrower write for one edited request — used after Send/Save on the
    /// active editor so a keystroke elsewhere doesn't trigger a full-tree
    /// rewrite. No-op until a directory is bound.
    func persist(_ spec: RequestSpec) async {
        guard let directoryURL else { return }
        do {
            try await store.saveRequest(spec, in: collection, to: directoryURL)
            lastError = nil
        } catch {
            lastError = "Couldn't save \(spec.name): \(error.localizedDescription)"
        }
    }

    /// Persists `updated` (if a directory is bound) before adopting it as
    /// the live tree — write-then-swap, so a failed save never leaves the
    /// UI showing content the disk doesn't actually have. `duplicate` and
    /// `move` both fold their tree edit through this. With no directory
    /// bound yet there's nothing on disk to protect, so the tree just
    /// updates.
    @discardableResult
    func adopt(_ updated: Collection) async -> Bool {
        guard let directoryURL else {
            collection = updated
            lastError = nil
            return true
        }
        do {
            try await store.save(updated, to: directoryURL)
            collection = updated
            lastError = nil
            return true
        } catch {
            lastError = "Couldn't save collection: \(error.localizedDescription)"
            return false
        }
    }

    /// Deletes every id in `ids` as one atomic disk operation — see
    /// `CollectionStore.deleteNodes`. Either the whole batch comes off disk
    /// and out of the tree, or (on any failure) neither does, so a
    /// mid-batch failure never leaves a half-deleted collection with no way
    /// back.
    func deleteNodes(ids: Set<String>) async {
        guard !ids.isEmpty else { return }
        guard let directoryURL else {
            collection.nodes = Self.removingAll(ids: ids, from: collection.nodes)
            return
        }
        do {
            try await store.deleteNodes(ids: ids, in: collection, from: directoryURL)
            collection.nodes = Self.removingAll(ids: ids, from: collection.nodes)
            lastError = nil
        } catch {
            lastError = "Couldn't delete \(ids.count) item\(ids.count == 1 ? "" : "s"): \(error.localizedDescription)"
        }
    }

    private static func seedCollection() -> Collection {
        let example = RequestSpec(
            name: "GET httpbin",
            method: .get,
            url: "https://httpbin.org/get",
        )
        return Collection(name: "My Collection", nodes: [.request(example)])
    }
}
