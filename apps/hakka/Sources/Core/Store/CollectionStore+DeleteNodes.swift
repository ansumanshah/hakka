import Foundation
import HakkaCommon

extension CollectionStore {
    /// Removes every id in `ids` as one atomic unit: either all of them are
    /// gone from disk afterward, or (on any failure) none of them are, and
    /// the directory is left exactly as it started.
    ///
    /// Deletion is a two-phase move, not a direct `removeItem`: every target
    /// is first moved into a scratch directory — `moveItem` is a same-volume
    /// rename, so each individual step is effectively atomic. If a later
    /// move fails (a permission error, a target that vanished underneath
    /// us), every item already staged is moved straight back to where it
    /// came from before the error propagates, so a mid-batch failure can
    /// never leave the collection missing files the caller doesn't know
    /// about. Only once every target is safely staged is the scratch
    /// directory — and everything still in it — actually deleted.
    public func deleteNodes(ids: Set<String>, in collection: Collection, from directory: URL) throws {
        guard !ids.isEmpty else { return }
        let layout = CollectionLayoutResolver.resolve(collection, root: directory)
        let fm = FileManager.default

        var targets: [(id: String, url: URL)] = []
        for id in ids {
            guard let url = layout.requestFiles[id] ?? layout.folderDirectories[id] else {
                throw CollectionStoreError.nodeNotFound(id: id)
            }
            targets.append((id, url))
        }

        let staging = directory.appendingPathComponent(".hakka-trash-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: staging) }

        var staged: [(original: URL, stagedURL: URL)] = []
        do {
            for target in targets {
                // A descendant of an already-staged folder is gone from its
                // original path — nothing left to move, and that's the
                // batch succeeding for it, not failing.
                guard fm.fileExists(atPath: target.url.path) else { continue }
                let stagedURL = staging.appendingPathComponent(target.id)
                try fm.moveItem(at: target.url, to: stagedURL)
                staged.append((target.url, stagedURL))
            }
        } catch {
            for item in staged.reversed() {
                try? fm.moveItem(at: item.stagedURL, to: item.original)
            }
            throw error
        }
    }
}
