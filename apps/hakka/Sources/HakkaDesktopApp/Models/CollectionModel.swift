import Foundation
import HakkaDesktopCore
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

    func saveAll() async {
        guard let directoryURL else { return }
        do {
            try await store.save(collection, to: directoryURL)
            lastError = nil
        } catch {
            lastError = "Couldn't save collection: \(error.localizedDescription)"
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

    private static func seedCollection() -> Collection {
        let example = RequestSpec(
            name: "GET httpbin",
            method: .get,
            url: "https://httpbin.org/get",
        )
        return Collection(name: "My Collection", nodes: [.request(example)])
    }
}
