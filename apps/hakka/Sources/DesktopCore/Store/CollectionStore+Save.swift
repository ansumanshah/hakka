import Foundation
import HakkaCommon

extension CollectionStore {
    func writeCollection(_ collection: Collection, to directory: URL) throws {
        let fm = FileManager.default
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)

        let metadata = CollectionMetadataFile(
            version: collectionFormatVersion,
            id: collection.id,
            name: collection.name,
            defaultHeaders: collection.defaultHeaders,
            auth: collection.auth,
            notes: collection.notes,
        )
        try writeFile(metadata, to: directory.appendingPathComponent(CollectionFileFormat.collectionMetadataFilename))

        let layout = CollectionLayoutResolver.resolve(collection, root: directory)
        try writeNodes(collection.nodes, layout: layout)
        try pruneStaleEntries(under: directory, keeping: layout, isRoot: true)
    }

    private func writeNodes(_ nodes: [CollectionNode], layout: ResolvedCollectionLayout) throws {
        let fm = FileManager.default
        for node in nodes {
            switch node {
            case let .request(spec):
                guard let url = layout.requestFiles[spec.id], let seq = layout.requestSeq[spec.id] else { continue }
                try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try writeFile(RequestFile(seq: seq, spec: spec), to: url)

            case let .folder(folder):
                guard let dirURL = layout.folderDirectories[folder.id],
                      let metaURL = layout.folderMetadataFiles[folder.id],
                      let seq = layout.folderSeq[folder.id]
                else { continue }
                try fm.createDirectory(at: dirURL, withIntermediateDirectories: true)
                let file = FolderFile(seq: seq, id: folder.id, name: folder.name, headers: folder.headers, auth: folder.auth)
                try writeFile(file, to: metaURL)
                try writeNodes(folder.children, layout: layout)
            }
        }
    }

    /// Walks the *actual* directory tree and removes anything the format
    /// recognizes (`.hakka` request files, `folder.hakka`-bearing
    /// directories) that `layout` no longer references — the mechanism
    /// behind both deletion and rename-as-move when a full tree is saved.
    /// Foreign files/directories a user dropped into the tree are left alone.
    private func pruneStaleEntries(under directory: URL, keeping layout: ResolvedCollectionLayout, isRoot: Bool) throws {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isDirectoryKey]) else {
            return
        }
        let keptRequestPaths = Set(layout.requestFiles.values.map(\.standardizedPath))
        let keptFolderPaths = Set(layout.folderDirectories.values.map(\.standardizedPath))

        for entry in entries {
            var isDirectory: ObjCBool = false
            fm.fileExists(atPath: entry.path, isDirectory: &isDirectory)

            if isDirectory.boolValue {
                let hasFolderMetadata = fm.fileExists(
                    atPath: entry.appendingPathComponent(CollectionFileFormat.folderMetadataFilename).path,
                )
                guard hasFolderMetadata else { continue }
                if keptFolderPaths.contains(entry.standardizedPath) {
                    try pruneStaleEntries(under: entry, keeping: layout, isRoot: false)
                } else {
                    try fm.removeItem(at: entry)
                }
            } else if entry.pathExtension == CollectionFileFormat.requestExtension {
                let name = entry.lastPathComponent
                if isRoot, name == CollectionFileFormat.collectionMetadataFilename { continue }
                if name == CollectionFileFormat.folderMetadataFilename { continue }
                if !keptRequestPaths.contains(entry.standardizedPath) {
                    try fm.removeItem(at: entry)
                }
            }
        }
    }

    func writeFile(_ value: some Encodable, to url: URL) throws {
        let data = try CollectionFileFormat.encode(value)
        try data.write(to: url, options: .atomic)
    }
}
