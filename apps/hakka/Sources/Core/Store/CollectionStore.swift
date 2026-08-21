import Foundation
import HakkaCommon

public enum CollectionStoreError: Error, Equatable, Sendable {
    case missingMetadata(path: String)
    case nodeNotFound(id: String)
    /// The collection was written by a newer Hakka than this one. Forward
    /// compatibility is not a promise this format makes, so refusing beats
    /// decoding a layout we do not understand and writing it back lossily.
    case unsupportedFormatVersion(found: Int, supported: Int)
}

/// Reads and writes the on-disk collection format: one directory per
/// collection, one `.hakka` JSON file per request, one subdirectory plus
/// `folder.hakka` per folder, `collection.hakka` at the root. Git-diffable
/// plain text is the point — see `CollectionFileFormat` for the byte
/// contract and `CollectionLayoutResolver` for the deterministic naming that
/// makes `load(save(x))` reproduce `x`.
///
/// An actor rather than a plain type so that concurrent `save`/`saveRequest`/
/// `deleteNode` calls against the same directory serialize instead of racing
/// on the filesystem; the type holds no other mutable state.
public actor CollectionStore {
    public init() {}

    public func load(directory: URL) throws -> Collection {
        try loadCollection(from: directory)
    }

    /// Writes every node in `collection`, creating folders as needed, then
    /// removes any `.hakka` file or folder directory under `directory` that
    /// `collection` no longer references. This full reconciliation is what
    /// makes a renamed or deleted node disappear from disk when the caller
    /// saves the whole tree; `saveRequest` is the narrower, single-file path.
    public func save(_ collection: Collection, to directory: URL) throws {
        try writeCollection(collection, to: directory)
    }

    /// Rewrites only `request`'s own file. `collection` is read in memory
    /// only, to compute where `request` belongs and what its current
    /// siblings are named — no other file's content is touched. If `request`
    /// was renamed since the last save, the single stale file for its id in
    /// its (unchanged) parent folder is removed; moving a request to a
    /// different folder is a structural edit and should go through `save`.
    public func saveRequest(_ request: RequestSpec, in collection: Collection, to directory: URL) throws {
        try writeSingleRequest(request, in: collection, to: directory)
    }

    /// Removes the file (request) or directory (folder) `nodeId` resolves to
    /// within `collection`. Throws `.nodeNotFound` if `collection` has no
    /// such id.
    public func deleteNode(id nodeId: String, in collection: Collection, from directory: URL) throws {
        try removeNode(id: nodeId, in: collection, from: directory)
    }
}
