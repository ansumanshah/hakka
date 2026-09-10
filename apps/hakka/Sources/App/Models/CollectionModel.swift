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
    /// The complete tree last known to have been read from or written to disk.
    /// It deliberately excludes local edits that have not completed a save.
    private var collectionDiskSnapshot: Collection?
    /// Disk snapshots from the last open/save, keyed by request id. They make
    /// an MCP edit visible as a save conflict instead of overwriting it.
    private var requestDiskSnapshots: [String: RequestSpec] = [:]

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
            let loaded = try await store.load(directory: directory)
            collection = loaded
            directoryURL = directory
            collectionDiskSnapshot = loaded
            requestDiskSnapshots = Self.requests(in: loaded.nodes)
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
        let savedCollection = collection
        do {
            try await store.saveRequest(
                spec,
                in: savedCollection,
                to: directoryURL,
                expectedDiskRequest: requestDiskSnapshots[spec.id],
                requireNewRequest: requestDiskSnapshots[spec.id] == nil
            )
            requestDiskSnapshots[spec.id] = spec
            if var diskSnapshot = collectionDiskSnapshot,
               Self.applySavedRequest(spec, from: savedCollection.nodes, to: &diskSnapshot.nodes)
            {
                collectionDiskSnapshot = diskSnapshot
            }
            lastError = nil
        } catch {
            lastError = "Couldn't save \(spec.name): \(error.localizedDescription)"
        }
    }

    /// Saves the current in-memory collection into a new or empty directory,
    /// then binds future writes to that directory. Existing destination
    /// content is preserved and reported as an error.
    @discardableResult
    func saveAs(to directory: URL) async -> Bool {
        let savedCollection = collection
        do {
            try await store.saveToEmptyDirectory(savedCollection, to: directory)
            directoryURL = directory
            collectionDiskSnapshot = savedCollection
            requestDiskSnapshots = Self.requests(in: savedCollection.nodes)
            lastError = nil
            return true
        } catch CollectionStoreError.destinationNotEmpty(path: _) {
            lastError = "Couldn't save collection: that folder already contains files. Choose a new or empty folder."
            return false
        } catch CollectionStoreError.writeLocked(path: let path) {
            lastError = "Couldn't save collection: close all Hakka writers, then remove \(path) and retry."
            return false
        } catch {
            lastError = "Couldn't save collection to \(directory.lastPathComponent): \(error.localizedDescription)"
            return false
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
            guard let collectionDiskSnapshot else {
                throw CollectionStoreError.concurrentModification(path: directoryURL.standardizedFileURL.path)
            }
            try await store.save(updated, to: directoryURL, expectedDiskCollection: collectionDiskSnapshot)
            collection = updated
            self.collectionDiskSnapshot = updated
            requestDiskSnapshots = Self.requests(in: updated.nodes)
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
            if var diskSnapshot = collectionDiskSnapshot {
                diskSnapshot.nodes = Self.removingAll(ids: ids, from: diskSnapshot.nodes)
                collectionDiskSnapshot = diskSnapshot
                requestDiskSnapshots = Self.requests(in: diskSnapshot.nodes)
            }
            lastError = nil
        } catch {
            lastError = "Couldn't delete \(ids.count) item\(ids.count == 1 ? "" : "s"): \(error.localizedDescription)"
        }
    }

    private static func seedCollection() -> Collection {
        let example = RequestSpec(
            name: "GET httpbin",
            method: .get,
            url: "https://httpbin.org/get"
        )
        return Collection(name: "My Collection", nodes: [.request(example)])
    }

    private static func requests(in nodes: [CollectionNode]) -> [String: RequestSpec] {
        nodes.reduce(into: [:]) { result, node in
            switch node {
            case let .request(request): result[request.id] = request
            case let .folder(folder): result.merge(requests(in: folder.children), uniquingKeysWith: { _, latest in latest })
            }
        }
    }

    /// Applies exactly the request write that completed to the saved snapshot.
    /// Existing requests can live at any depth. New native requests are root
    /// additions; insert them relative to already-saved siblings so saving two
    /// new drafts out of order still reproduces the disk's sequence order.
    private static func applySavedRequest(
        _ spec: RequestSpec,
        from liveNodes: [CollectionNode],
        to diskNodes: inout [CollectionNode]
    ) -> Bool {
        if findRequest(id: spec.id, in: diskNodes) != nil {
            diskNodes = replacing(spec, in: diskNodes)
            return true
        }
        guard let liveIndex = liveNodes.firstIndex(where: { node in
            if case let .request(request) = node { return request.id == spec.id }
            return false
        }) else { return false }

        let diskIDs = Set(diskNodes.map(\.id))
        if let nextID = liveNodes[(liveIndex + 1)...].map(\.id).first(where: diskIDs.contains),
           let insertionIndex = diskNodes.firstIndex(where: { $0.id == nextID })
        {
            diskNodes.insert(.request(spec), at: insertionIndex)
            return true
        }
        if let previousID = liveNodes[..<liveIndex].reversed().map(\.id).first(where: diskIDs.contains),
           let previousIndex = diskNodes.firstIndex(where: { $0.id == previousID })
        {
            diskNodes.insert(.request(spec), at: previousIndex + 1)
            return true
        }
        guard diskNodes.isEmpty else { return false }
        diskNodes.append(.request(spec))
        return true
    }
}
