import Foundation
import HakkaCommon
import HakkaCore

/// Supplies the on-disk collection directories the collections MCP tools
/// should read. Protocol-based rather than a direct dependency on
/// `CollectionModel` because `HakkaServer` cannot depend on `HakkaApp` —
/// `CollectionModel` is `@MainActor`/`@Observable` UI state that lives in
/// the App target, bound to a directory only once the user opens a folder.
/// The app layer supplies a small adapter conforming to this at
/// server-start time; tests here use an in-memory fake with no UI, no
/// `MainActor`, and fixture directories written by `CollectionStore` itself.
public protocol MCPCollectionDirectoryProvider: Sendable {
    /// Every collection directory currently open, in display order. Empty
    /// when nothing is open yet — `list_collections` reports that as zero
    /// collections rather than an error, matching `CollectionModel`'s "the
    /// app is usable before any directory is bound" design.
    func collectionDirectories() async -> [URL]
}

/// One directory's load attempt — `list_collections` reports a directory
/// that fails to load (missing metadata, an unsupported format version, a
/// deleted folder) as an entry with `loadError` set rather than failing the
/// whole call, so one bad collection never hides every other one.
struct MCPCollectionLoad: Sendable {
    let directory: URL
    let collection: Collection?
    let loadError: String?
}

/// Reads collections directly from disk via `CollectionStore` on every
/// call — no caching, so a save made from the app's own UI is visible to
/// the very next MCP call with no invalidation logic needed anywhere.
public actor MCPCollectionSource {
    private let store: CollectionStore
    private let provider: MCPCollectionDirectoryProvider

    public init(store: CollectionStore = CollectionStore(), provider: MCPCollectionDirectoryProvider) {
        self.store = store
        self.provider = provider
    }

    func loadAll() async -> [MCPCollectionLoad] {
        var results: [MCPCollectionLoad] = []
        for directory in await provider.collectionDirectories() {
            do {
                let collection = try await store.load(directory: directory)
                results.append(MCPCollectionLoad(directory: directory, collection: collection, loadError: nil))
            } catch {
                results.append(MCPCollectionLoad(directory: directory, collection: nil, loadError: "\(error)"))
            }
        }
        return results
    }

    /// Searches every loaded collection (or only the one matching
    /// `collectionId`, when given) for a request node with id `id`, depth
    /// first. `nil` when nothing matches, including when `collectionId`
    /// names a collection that failed to load or isn't open.
    func requestSpec(id: String, collectionId: String?) async -> RequestSpec? {
        for load in await loadAll() {
            guard let collection = load.collection else { continue }
            if let collectionId, collection.id != collectionId { continue }
            if let found = Self.findRequest(id: id, in: collection.nodes) { return found }
        }
        return nil
    }

    private static func findRequest(id: String, in nodes: [CollectionNode]) -> RequestSpec? {
        for node in nodes {
            switch node {
            case let .request(spec):
                if spec.id == id { return spec }
            case let .folder(folder):
                if let found = findRequest(id: id, in: folder.children) { return found }
            }
        }
        return nil
    }

    /// `(requests, folders)` counted recursively — used for `list_collections`'
    /// per-collection summary so a caller can tell an empty collection from
    /// one it just hasn't looked inside yet.
    static func countNodes(_ nodes: [CollectionNode]) -> (requests: Int, folders: Int) {
        var requests = 0
        var folders = 0
        for node in nodes {
            switch node {
            case .request:
                requests += 1
            case let .folder(folder):
                folders += 1
                let nested = countNodes(folder.children)
                requests += nested.requests
                folders += nested.folders
            }
        }
        return (requests, folders)
    }
}
