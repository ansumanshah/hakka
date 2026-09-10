import Darwin
import Foundation
import HakkaCommon

public enum CollectionStoreError: Error, Equatable, LocalizedError, Sendable {
    case missingMetadata(path: String)
    case nodeNotFound(id: String)
    /// Save As only initializes a new or empty directory. Existing content is
    /// never reconciled away as part of choosing a destination.
    case destinationNotEmpty(path: String)
    /// A managed CLI/MCP writer owns the collection directory. Refuse the
    /// native write so its in-memory draft cannot replace an unseen change.
    case concurrentModification(path: String)
    /// The shared sidecar already exists. It may represent an active writer or
    /// a crashed one; Hakka never guesses and removes it automatically.
    case writeLocked(path: String)
    /// The collection was written by a newer Hakka than this one. Forward
    /// compatibility is not a promise this format makes, so refusing beats
    /// decoding a layout we do not understand and writing it back lossily.
    case unsupportedFormatVersion(found: Int, supported: Int)

    public var errorDescription: String? {
        switch self {
        case let .missingMetadata(path):
            "Collection metadata is missing at \(path)."
        case let .nodeNotFound(id):
            "Collection item \(id) was not found."
        case let .destinationNotEmpty(path):
            "The destination \(path) already contains files. Choose a new or empty folder."
        case let .concurrentModification(path):
            "The collection changed on disk at \(path). Reload it, resolve the draft, and retry."
        case let .writeLocked(path):
            "Another Hakka writer may be saving this collection. Close all Hakka writers, then remove \(path) and retry."
        case let .unsupportedFormatVersion(found, supported):
            "Collection format version \(found) is newer than the supported version \(supported)."
        }
    }
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
    public func save(
        _ collection: Collection,
        to directory: URL,
        expectedDiskCollection: Collection? = nil
    ) throws {
        try withCollectionWriteLock(in: directory) {
            if let expectedDiskCollection, try loadCollection(from: directory) != expectedDiskCollection {
                throw CollectionStoreError.concurrentModification(path: directory.standardizedPath)
            }
            try writeCollection(collection, to: directory)
        }
    }

    /// Initializes `directory` only while it is still empty. The emptiness
    /// check runs under the same cross-process lock as the write, so another
    /// managed Hakka writer cannot claim or populate the destination between
    /// the check and the save.
    public func saveToEmptyDirectory(_ collection: Collection, to directory: URL) throws {
        try withCollectionWriteLock(in: directory) {
            let entries = try FileManager.default.contentsOfDirectory(
                at: directory,
                includingPropertiesForKeys: nil
            )
            guard entries.allSatisfy({ $0.lastPathComponent == ".hakka-write.lock" }) else {
                throw CollectionStoreError.destinationNotEmpty(path: directory.standardizedPath)
            }
            try writeCollection(collection, to: directory)
        }
    }

    /// Rewrites only `request`'s own file. `collection` is read in memory
    /// only, to compute where `request` belongs and what its current
    /// siblings are named — no other file's content is touched. If `request`
    /// was renamed since the last save, the single stale file for its id in
    /// its (unchanged) parent folder is removed; moving a request to a
    /// different folder is a structural edit and should go through `save`.
    public func saveRequest(
        _ request: RequestSpec,
        in collection: Collection,
        to directory: URL,
        expectedDiskRequest: RequestSpec? = nil,
        requireNewRequest: Bool = false
    ) throws {
        try withCollectionWriteLock(in: directory) {
            try writeSingleRequest(
                request,
                in: collection,
                to: directory,
                expectedDiskRequest: expectedDiskRequest,
                requireNewRequest: requireNewRequest
            )
        }
    }

    /// Removes the file (request) or directory (folder) `nodeId` resolves to
    /// within `collection`. Throws `.nodeNotFound` if `collection` has no
    /// such id.
    public func deleteNode(id nodeId: String, in collection: Collection, from directory: URL) throws {
        try withCollectionWriteLock(in: directory) {
            try removeNode(id: nodeId, in: collection, from: directory)
        }
    }

    private struct CollectionWriteLock: Codable, Equatable {
        let version: Int
        let pid: Int32
        let nonce: String
        let createdAt: Int64
    }

    /// Managed CLI/MCP writes acquire this same exclusive sidecar before their
    /// read-check-replace sequence. An existing lock always fails closed. A
    /// stale lock must be removed explicitly after confirming no writer is
    /// active: POSIX has no portable conditional rename/unlink that could
    /// reclaim only the record inspected without racing a new owner.
    private func withCollectionWriteLock<T>(in directory: URL, _ work: () throws -> T) throws -> T {
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        let lockURL = directory.appendingPathComponent(".hakka-write.lock")
        let record = CollectionWriteLock(
            version: 1,
            pid: getpid(),
            nonce: UUID().uuidString,
            createdAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
        let data = try JSONEncoder().encode(record)
        do {
            try data.write(to: lockURL, options: .withoutOverwriting)
        } catch {
            let writeError = error as NSError
            let isExistingLock =
                (writeError.domain == NSCocoaErrorDomain && writeError.code == CocoaError.Code.fileWriteFileExists.rawValue) ||
                (writeError.domain == NSPOSIXErrorDomain && writeError.code == EEXIST)
            guard isExistingLock else { throw error }
            throw CollectionStoreError.writeLocked(path: lockURL.standardizedPath)
        }
        defer {
            if (try? Data(contentsOf: lockURL)) == data {
                try? fm.removeItem(at: lockURL)
            }
        }
        return try work()
    }
}
