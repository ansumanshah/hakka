import Foundation
import HakkaServer

/// Adapts `CollectionModel`'s single bound directory to the multi-directory
/// shape `MCPCollectionDirectoryProvider` expects. `CollectionModel` only
/// ever binds one directory today — `directoryURL: URL?`, set once by
/// `open(directory:)` — so this wraps it in an array rather than reaching
/// for a multi-collection model that doesn't exist yet. Before anything is
/// open the array comes back empty, which is exactly what the protocol's own
/// doc comment says `list_collections` should treat as "zero collections",
/// not an error.
///
/// `@MainActor`, not an `actor`: `collectionModel` is itself `@MainActor`
/// state, and hopping through a second, unrelated actor just to read one
/// property would add latency with no isolation benefit. The `Sendable`
/// conformance `MCPCollectionDirectoryProvider` requires is safe here
/// specifically because every stored property below is only ever touched
/// from this same global actor — the compiler accepts a `@MainActor final
/// class` as `Sendable` on that basis.
@MainActor
final class MCPCollectionDirectoryAdapter: MCPCollectionDirectoryProvider {
    private let collectionModel: CollectionModel

    init(collectionModel: CollectionModel) {
        self.collectionModel = collectionModel
    }

    func collectionDirectories() async -> [URL] {
        collectionModel.directoryURL.map { [$0] } ?? []
    }
}
