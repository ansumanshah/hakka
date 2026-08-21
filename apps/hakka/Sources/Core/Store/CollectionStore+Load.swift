import Foundation
import HakkaCommon

extension CollectionStore {
    func loadCollection(from directory: URL) throws -> Collection {
        let metadataURL = directory.appendingPathComponent(CollectionFileFormat.collectionMetadataFilename)
        guard let metadataData = try? Data(contentsOf: metadataURL) else {
            throw CollectionStoreError.missingMetadata(path: metadataURL.standardizedPath)
        }
        let metadata = try CollectionFileFormat.decode(CollectionMetadataFile.self, from: metadataData)
        guard metadata.effectiveVersion <= collectionFormatVersion else {
            throw CollectionStoreError.unsupportedFormatVersion(
                found: metadata.effectiveVersion,
                supported: collectionFormatVersion,
            )
        }
        let nodes = try readNodes(in: directory)
        return Collection(
            id: metadata.id,
            name: metadata.name,
            nodes: nodes,
            defaultHeaders: metadata.defaultHeaders,
            auth: metadata.auth,
            notes: metadata.notes,
        )
    }

    /// Reads one directory level: every `folder.hakka`-containing
    /// subdirectory becomes a folder (recursed into), every other
    /// `.hakka` file becomes a request. Ordered by each entry's own `seq`,
    /// tie-broken by filename so a corrupt duplicate `seq` still sorts
    /// deterministically rather than depending on directory-listing order.
    private func readNodes(in directory: URL) throws -> [CollectionNode] {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.isDirectoryKey],
        ) else {
            return []
        }

        var ordered: [(seq: Int, name: String, node: CollectionNode)] = []
        for entry in entries {
            if let folderNode = try readFolder(at: entry) {
                ordered.append(folderNode)
            } else if let requestNode = try readRequest(at: entry) {
                ordered.append(requestNode)
            }
        }
        ordered.sort { lhs, rhs in
            lhs.seq != rhs.seq ? lhs.seq < rhs.seq : lhs.name < rhs.name
        }
        return ordered.map(\.node)
    }

    private func readFolder(at directoryURL: URL) throws -> (seq: Int, name: String, node: CollectionNode)? {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directoryURL.path, isDirectory: &isDirectory),
              isDirectory.boolValue
        else {
            return nil
        }
        let metadataURL = directoryURL.appendingPathComponent(CollectionFileFormat.folderMetadataFilename)
        guard let data = try? Data(contentsOf: metadataURL) else { return nil }
        let file = try CollectionFileFormat.decode(FolderFile.self, from: data)
        let children = try readNodes(in: directoryURL)
        let folder = Folder(id: file.id, name: file.name, children: children, headers: file.headers, auth: file.auth)
        return (file.seq, directoryURL.lastPathComponent, .folder(folder))
    }

    private func readRequest(at fileURL: URL) throws -> (seq: Int, name: String, node: CollectionNode)? {
        guard fileURL.pathExtension == CollectionFileFormat.requestExtension,
              !CollectionFileFormat.isContainerMetadataFilename(fileURL.lastPathComponent)
        else {
            return nil
        }
        let data = try Data(contentsOf: fileURL)
        let file = try CollectionFileFormat.decode(RequestFile.self, from: data)
        return (file.seq, fileURL.lastPathComponent, .request(file.spec))
    }
}
