import Foundation
import HakkaCommon

extension CollectionStore {
    func writeSingleRequest(_ request: RequestSpec, in collection: Collection, to directory: URL) throws {
        let layout = CollectionLayoutResolver.resolve(collection, root: directory)
        guard let targetURL = layout.requestFiles[request.id], let seq = layout.requestSeq[request.id] else {
            throw CollectionStoreError.nodeNotFound(id: request.id)
        }
        let fm = FileManager.default
        let parentDirectory = targetURL.deletingLastPathComponent()
        try fm.createDirectory(at: parentDirectory, withIntermediateDirectories: true)
        try removeStaleSibling(ofRequestId: request.id, keeping: targetURL, in: parentDirectory)
        try writeFile(RequestFile(seq: seq, spec: request), to: targetURL)
    }

    /// A rename changes `request`'s slug, so its old file (same id, different
    /// name) is still sitting in `parentDirectory` alongside the new one this
    /// call is about to write. Find it by decoding each `.hakka` sibling's
    /// own `id` — the filename is derived data, never the source of truth —
    /// and remove it. No other sibling is read for any purpose but this id
    /// check, and none is written.
    private func removeStaleSibling(ofRequestId id: String, keeping targetURL: URL, in parentDirectory: URL) throws {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: parentDirectory, includingPropertiesForKeys: nil) else {
            return
        }
        for entry in entries {
            guard entry.standardizedPath != targetURL.standardizedPath,
                  entry.pathExtension == CollectionFileFormat.requestExtension,
                  !CollectionFileFormat.isContainerMetadataFilename(entry.lastPathComponent),
                  let data = try? Data(contentsOf: entry),
                  let file = try? CollectionFileFormat.decode(RequestFile.self, from: data),
                  file.spec.id == id
            else { continue }
            try fm.removeItem(at: entry)
        }
    }

    func removeNode(id nodeId: String, in collection: Collection, from directory: URL) throws {
        let layout = CollectionLayoutResolver.resolve(collection, root: directory)
        let fm = FileManager.default
        if let fileURL = layout.requestFiles[nodeId] {
            if fm.fileExists(atPath: fileURL.path) {
                try fm.removeItem(at: fileURL)
            }
            return
        }
        if let dirURL = layout.folderDirectories[nodeId] {
            if fm.fileExists(atPath: dirURL.path) {
                try fm.removeItem(at: dirURL)
            }
            return
        }
        throw CollectionStoreError.nodeNotFound(id: nodeId)
    }
}
